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
import { Queue } from 'bullmq';
import type { Request } from 'express';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.interface';
import { WEBHOOK_QUEUE } from './payments.constants';

// Paystack webhook. Signature is verified against the raw request body before
// anything is trusted; the actual business logic (transaction upsert, invoice
// status update) runs asynchronously via BullMQ so retries/backoff (NFR-02)
// don't block the HTTP response Paystack expects within a few seconds.
@Controller('payments/webhooks')
export class WebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

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
    await this.webhookQueue.add('process-webhook', event, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });

    return { received: true };
  }
}
