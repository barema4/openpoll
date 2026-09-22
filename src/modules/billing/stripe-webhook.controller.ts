import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { verifyStripeSignature } from './stripe-signature.util';
import { STRIPE_WEBHOOK_QUEUE } from './billing.constants';
import type { StripeSubscriptionEvent } from './stripe-event.type';

const HANDLED_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

// Structured exactly like WebhookController (Paystack) — raw-body HMAC
// verification (global rawBody: true in main.ts) before anything is
// trusted, actual handling deferred to a BullMQ queue so retries/backoff
// don't block the HTTP response Stripe expects within a few seconds.
@ApiTags('billing')
@Controller('billing/webhooks')
export class StripeWebhookController {
  constructor(
    @InjectQueue(STRIPE_WEBHOOK_QUEUE)
    private readonly stripeWebhookQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @Post('stripe')
  async handleStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signatureHeader: string | undefined,
  ) {
    const rawBody = request.rawBody;
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (
      !rawBody ||
      !webhookSecret ||
      !verifyStripeSignature(rawBody, signatureHeader, webhookSecret)
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = JSON.parse(
      rawBody.toString('utf8'),
    ) as StripeSubscriptionEvent;

    // Every other Stripe event type (invoices, payment methods, etc.) is
    // ignored — agencyPlanExpiresAt is derived entirely from the
    // subscription object's own current_period_end/status.
    if (HANDLED_EVENT_TYPES.has(event.type)) {
      await this.stripeWebhookQueue.add('process-stripe-webhook', event, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      });
    }

    return { received: true };
  }
}
