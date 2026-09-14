import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TransactionsService } from '../transactions/transactions.service';
import { DISPUTE_WEBHOOK_QUEUE } from './payments.constants';
import type { ParsedDisputeWebhookEvent } from './providers/paystack.provider';

// Paystack only — mobile money has no chargeback mechanism, so PawaPay never
// produces dispute events. Handles create, periodic reminders, and the final
// resolution; TransactionsService.handleDisputeEvent contains all the
// idempotency/notification/reversal logic, keeping this a thin dispatcher
// (same shape as RefundWebhookProcessor).
@Processor(DISPUTE_WEBHOOK_QUEUE)
export class DisputeWebhookProcessor extends WorkerHost {
  constructor(private readonly transactions: TransactionsService) {
    super();
  }

  async process(job: Job<ParsedDisputeWebhookEvent>) {
    await this.transactions.handleDisputeEvent(job.data);
  }
}
