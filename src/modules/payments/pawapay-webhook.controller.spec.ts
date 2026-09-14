import { PawaPayWebhookController } from './pawapay-webhook.controller';
import type { PawaPayProvider } from './providers/pawapay.provider';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { TransactionsService } from '../transactions/transactions.service';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { Queue } from 'bullmq';

function makeRequest(body: Record<string, unknown>): RawBodyRequest<Request> {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { rawBody } as unknown as RawBodyRequest<Request>;
}

describe('PawaPayWebhookController — refund branch', () => {
  it('routes a refundId callback straight to TransactionsService.completeRefund (no queue, mirrors payout handling)', async () => {
    const provider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    } as unknown as PawaPayProvider;
    const completeRefund = jest.fn();
    const controller = new PawaPayWebhookController(
      provider,
      {} as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      { completeRefund } as unknown as TransactionsService,
      {} as unknown as Queue,
      {} as unknown as Queue,
    );

    const request = makeRequest({
      refundId: 'refund-abc',
      status: 'COMPLETED',
    });

    const result = await controller.handlePawaPayWebhook(request);

    expect(completeRefund).toHaveBeenCalledWith('refund-abc', true, undefined);
    expect(result).toEqual({ received: true });
  });

  it('reports a failed refund with the failure message', async () => {
    const provider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    } as unknown as PawaPayProvider;
    const completeRefund = jest.fn();
    const controller = new PawaPayWebhookController(
      provider,
      {} as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      { completeRefund } as unknown as TransactionsService,
      {} as unknown as Queue,
      {} as unknown as Queue,
    );

    const request = makeRequest({
      refundId: 'refund-abc',
      status: 'FAILED',
      failureReason: { failureMessage: 'insufficient balance' },
    });

    await controller.handlePawaPayWebhook(request);

    expect(completeRefund).toHaveBeenCalledWith(
      'refund-abc',
      false,
      'insufficient balance',
    );
  });
});
