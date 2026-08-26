import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.interface';
import { WEBHOOK_QUEUE } from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';

// Paystack webhook. Signature is verified against the raw request body before
// anything is trusted; the actual business logic (transaction upsert, invoice
// status update) runs asynchronously via BullMQ so retries/backoff (NFR-02)
// don't block the HTTP response Paystack expects within a few seconds.
@ApiTags('payments')
@Controller('payments/webhooks')
export class WebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
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
