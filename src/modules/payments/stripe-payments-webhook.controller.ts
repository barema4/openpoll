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
import { InjectQueue } from '@nestjs/bullmq';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { StripeProvider } from './providers/stripe.provider';
import {
  WEBHOOK_QUEUE,
  REFUND_WEBHOOK_QUEUE,
  DISPUTE_WEBHOOK_QUEUE,
} from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';

// A Stripe webhook endpoint receives every subscribed event type, not just
// charge-relevant ones — unlike Paystack, which only ever posts here for
// charge/refund/dispute events. Everything else (payment_intent.created,
// etc.) is ignored before parseWebhookEvent, which assumes a Checkout
// Session-shaped payload.
const HANDLED_EVENT_TYPE = 'checkout.session.completed';

// Stripe donor-charging webhook — a sibling to WebhookController (Paystack)
// and PawaPayWebhookController, not a shared controller, since each
// provider's signature scheme/payload shape is different. A distinct route
// and signing secret (STRIPE_DONOR_WEBHOOK_SECRET) from BillingModule's own
// Stripe webhook controller, which is a completely separate Stripe
// integration (Agency-plan subscriptions, not donor charges).
@ApiTags('payments')
@Controller('payments/webhooks')
export class StripePaymentsWebhookController {
  constructor(
    private readonly provider: StripeProvider,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(PERSONAL_INVOICE_WEBHOOK_QUEUE)
    private readonly personalInvoiceWebhookQueue: Queue,
    @InjectQueue(REFUND_WEBHOOK_QUEUE)
    private readonly refundWebhookQueue: Queue,
    @InjectQueue(DISPUTE_WEBHOOK_QUEUE)
    private readonly disputeWebhookQueue: Queue,
  ) {}

  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @Post('stripe')
  async handleStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody || !this.provider.verifySignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (this.provider.isRefundEvent(rawBody)) {
      const refundEvent = this.provider.parseRefundWebhookEvent(rawBody);
      await this.refundWebhookQueue.add('process-refund-webhook', refundEvent, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      });
      return { received: true };
    }
    if (this.provider.isDisputeEvent(rawBody)) {
      const disputeEvent = this.provider.parseDisputeWebhookEvent(rawBody);
      await this.disputeWebhookQueue.add(
        'process-dispute-webhook',
        disputeEvent,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      );
      return { received: true };
    }

    const { type } = JSON.parse(rawBody.toString('utf8')) as { type: string };
    if (type !== HANDLED_EVENT_TYPE) {
      return { received: true };
    }

    const event = this.provider.parseWebhookEvent(rawBody);
    const queue = event.personalInvoiceId
      ? this.personalInvoiceWebhookQueue
      : this.webhookQueue;
    await queue.add('process-webhook', event, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });

    return { received: true };
  }
}
