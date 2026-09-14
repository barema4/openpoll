import { RefundWebhookProcessor } from './refund-webhook.processor';
import type { TransactionsService } from '../transactions/transactions.service';
import type { ParsedRefundWebhookEvent } from './providers/paystack.provider';
import type { Job } from 'bullmq';

function makeJob(overrides: Partial<ParsedRefundWebhookEvent> = {}): Job {
  return {
    data: {
      refundReference: 'ps_refund_1',
      transactionReference: 'ref-1',
      succeeded: true,
      ...overrides,
    },
  } as unknown as Job;
}

describe('RefundWebhookProcessor', () => {
  it('delegates to TransactionsService.completeRefund with the parsed refund reference and outcome', async () => {
    const completeRefund = jest.fn();
    const processor = new RefundWebhookProcessor({
      completeRefund,
    } as unknown as TransactionsService);

    await processor.process(makeJob({ succeeded: false }));

    expect(completeRefund).toHaveBeenCalledWith('ps_refund_1', false);
  });
});
