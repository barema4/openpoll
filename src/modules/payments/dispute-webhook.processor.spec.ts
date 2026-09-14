import { DisputeWebhookProcessor } from './dispute-webhook.processor';
import type { TransactionsService } from '../transactions/transactions.service';
import type { ParsedDisputeWebhookEvent } from './providers/paystack.provider';
import type { Job } from 'bullmq';

function makeJob(overrides: Partial<ParsedDisputeWebhookEvent> = {}): Job {
  return {
    data: {
      providerReference: 'dispute-1',
      transactionReference: 'ref-1',
      status: 'AWAITING_MERCHANT_FEEDBACK',
      resolution: null,
      amount: 1000,
      reason: null,
      ...overrides,
    },
  } as unknown as Job;
}

describe('DisputeWebhookProcessor', () => {
  it('delegates the parsed event straight to TransactionsService.handleDisputeEvent', async () => {
    const handleDisputeEvent = jest.fn();
    const processor = new DisputeWebhookProcessor({
      handleDisputeEvent,
    } as unknown as TransactionsService);
    const job = makeJob();

    await processor.process(job);

    expect(handleDisputeEvent).toHaveBeenCalledWith(job.data);
  });
});
