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
import { PaystackProvider } from './providers/paystack.provider';
import { WEBHOOK_QUEUE } from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';

// Paystack webhook (Kenya only — Uganda/PawaPay has its own controller, see
// pawapay-webhook.controller.ts, since the signature scheme and payload
// shape are completely different). Signature is verified against the raw
// request body before anything is trusted; the actual business logic
// (transaction upsert, invoice status update) runs asynchronously via
// BullMQ so retries/backoff don't block the HTTP response Paystack expects
// within a few seconds.
@ApiTags('payments')
@Controller('payments/webhooks')
export class WebhookController {
  constructor(
    private readonly provider: PaystackProvider,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(PERSONAL_INVOICE_WEBHOOK_QUEUE)
    private readonly personalInvoiceWebhookQueue: Queue,
  ) {}

  // Machine-to-machine only (requires a real Paystack HMAC signature over
  // the raw body) — excluded from the interactive docs UI.
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @Post('paystack')
  async handlePaystackWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody || !this.provider.verifySignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
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
