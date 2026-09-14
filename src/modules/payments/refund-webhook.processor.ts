import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TransactionsService } from '../transactions/transactions.service';
import { REFUND_WEBHOOK_QUEUE } from './payments.constants';
import type { ParsedRefundWebhookEvent } from './providers/paystack.provider';

// Paystack only — PawaPay's refund callback is handled synchronously inline
// in PawaPayWebhookController, mirroring how payout completion is already
// handled there (no queue). Idempotency (a redelivered webhook is a no-op)
// is handled inside TransactionsService.completeRefund, which checks the
// Refund's current status before doing anything.
@Processor(REFUND_WEBHOOK_QUEUE)
export class RefundWebhookProcessor extends WorkerHost {
  constructor(private readonly transactions: TransactionsService) {
    super();
  }

  async process(job: Job<ParsedRefundWebhookEvent>) {
    const event = job.data;
    await this.transactions.completeRefund(
      event.refundReference,
      event.succeeded,
    );
  }
}
