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

describe('PawaPayWebhookController — payout branch', () => {
  function makeController(prisma: PrismaService, audit: AuditService) {
    const provider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    } as unknown as PawaPayProvider;
    return new PawaPayWebhookController(
      provider,
      prisma,
      audit,
      {} as unknown as TransactionsService,
      {} as unknown as Queue,
      {} as unknown as Queue,
    );
  }

  it('completes a matching Withdrawal when one exists for the payoutId', async () => {
    const findUniqueWithdrawal = jest.fn().mockResolvedValue({
      id: 'wd-1',
      organizationId: 'org-1',
      status: 'PROCESSING',
    });
    const updateWithdrawal = jest.fn().mockResolvedValue({});
    const findUniqueDisbursement = jest.fn();
    const recordAudit = jest.fn();
    const prisma = {
      withdrawal: {
        findUnique: findUniqueWithdrawal,
        update: updateWithdrawal,
      },
      disbursement: { findUnique: findUniqueDisbursement },
    } as unknown as PrismaService;
    const audit = { record: recordAudit } as unknown as AuditService;
    const controller = makeController(prisma, audit);

    await controller.handlePawaPayWebhook(
      makeRequest({ payoutId: 'payout-abc', status: 'COMPLETED' }),
    );

    expect(updateWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wd-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }) as unknown,
      }),
    );
    expect(findUniqueDisbursement).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAWAL_COMPLETED' }),
    );
  });

  it('falls back to a matching Disbursement when no Withdrawal has this payoutId', async () => {
    const findUniqueWithdrawal = jest.fn().mockResolvedValue(null);
    const findUniqueDisbursement = jest.fn().mockResolvedValue({
      id: 'disb-1',
      eventId: 'event-1',
      budgetCategoryId: 'cat-1',
      status: 'QUEUED',
    });
    const updateDisbursement = jest.fn().mockResolvedValue({});
    const recordAudit = jest.fn();
    const prisma = {
      withdrawal: { findUnique: findUniqueWithdrawal },
      disbursement: {
        findUnique: findUniqueDisbursement,
        update: updateDisbursement,
      },
    } as unknown as PrismaService;
    const audit = { record: recordAudit } as unknown as AuditService;
    const controller = makeController(prisma, audit);

    await controller.handlePawaPayWebhook(
      makeRequest({ payoutId: 'payout-xyz', status: 'COMPLETED' }),
    );

    expect(updateDisbursement).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'disb-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }) as unknown,
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VENDOR_PAYOUT_COMPLETED',
        eventId: 'event-1',
      }),
    );
  });

  it('marks a failed disbursement payout FAILED with the failure message', async () => {
    const findUniqueDisbursement = jest.fn().mockResolvedValue({
      id: 'disb-1',
      eventId: 'event-1',
      budgetCategoryId: 'cat-1',
      status: 'QUEUED',
    });
    const updateDisbursement = jest.fn().mockResolvedValue({});
    const prisma = {
      withdrawal: { findUnique: jest.fn().mockResolvedValue(null) },
      disbursement: {
        findUnique: findUniqueDisbursement,
        update: updateDisbursement,
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = makeController(prisma, audit);

    await controller.handlePawaPayWebhook(
      makeRequest({
        payoutId: 'payout-xyz',
        status: 'FAILED',
        failureReason: { failureMessage: 'insufficient balance' },
      }),
    );

    expect(updateDisbursement).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'insufficient balance',
        }) as unknown,
      }),
    );
  });

  it('does nothing for an already-resolved disbursement (redelivered callback)', async () => {
    const findUniqueDisbursement = jest.fn().mockResolvedValue({
      id: 'disb-1',
      eventId: 'event-1',
      budgetCategoryId: 'cat-1',
      status: 'SUCCESS',
    });
    const updateDisbursement = jest.fn();
    const prisma = {
      withdrawal: { findUnique: jest.fn().mockResolvedValue(null) },
      disbursement: {
        findUnique: findUniqueDisbursement,
        update: updateDisbursement,
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = makeController(prisma, audit);

    await controller.handlePawaPayWebhook(
      makeRequest({ payoutId: 'payout-xyz', status: 'COMPLETED' }),
    );

    expect(updateDisbursement).not.toHaveBeenCalled();
  });

  it('does nothing when the payoutId matches neither a Withdrawal nor a Disbursement', async () => {
    const prisma = {
      withdrawal: { findUnique: jest.fn().mockResolvedValue(null) },
      disbursement: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const controller = makeController(prisma, audit);

    await expect(
      controller.handlePawaPayWebhook(
        makeRequest({ payoutId: 'unknown', status: 'COMPLETED' }),
      ),
    ).resolves.toEqual({ received: true });
  });
});
