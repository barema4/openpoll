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
import { verifyStripeSignature } from '../../common/stripe-signature.util';
import { STRIPE_CONNECT_WEBHOOK_QUEUE } from './stripe-connect.constants';
import type { StripeAccountEvent } from './stripe-account-event.type';

// A dedicated Connect webhook endpoint/secret — distinct from both
// BillingModule's (Agency-plan subscriptions) and the donor-payments one in
// PaymentsModule, matching this codebase's "one Stripe integration, one
// endpoint, one secret" convention throughout.
@ApiTags('stripe-connect')
@Controller('stripe-connect/webhooks')
export class StripeConnectWebhookController {
  constructor(
    @InjectQueue(STRIPE_CONNECT_WEBHOOK_QUEUE)
    private readonly stripeConnectWebhookQueue: Queue,
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
    const webhookSecret = this.config.get<string>(
      'STRIPE_CONNECT_WEBHOOK_SECRET',
    );
    if (
      !rawBody ||
      !webhookSecret ||
      !verifyStripeSignature(rawBody, signatureHeader, webhookSecret)
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as StripeAccountEvent;
    if (event.type === 'account.updated') {
      await this.stripeConnectWebhookQueue.add(
        'process-account-updated',
        event,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      );
    }

    return { received: true };
  }
}
