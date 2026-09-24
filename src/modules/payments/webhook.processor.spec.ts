import { WebhookProcessor } from './webhook.processor';
import {
  TransactionStatus,
  PaymentRail,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PaymentProviderRegistry } from './providers/payment-provider.registry';
import type { Job } from 'bullmq';

describe('WebhookProcessor', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  function makeJob(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        eventType: 'charge.success',
        providerReference: 'ref-1',
        amountSettled: 500,
        status: TransactionStatus.SUCCESS,
        paymentRail: PaymentRail.CARD,
        invoiceId: 'inv-1',
        eventId: 'event-1',
        provider: 'PAYSTACK',
        currency: 'KES',
        ...overrides,
      },
    } as unknown as Job;
  }

  function makePrismaMock(
    opts: {
      existingTransaction?: unknown;
      invoice?: unknown;
    } = {},
  ) {
    const transaction = {
      findUnique: jest.fn().mockResolvedValue(opts.existingTransaction ?? null),
      create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };
    const invoice = {
      findUnique: jest.fn().mockResolvedValue(
        opts.invoice ?? {
          expiresAt: new Date(),
          status: 'PENDING',
          amountRequested: '500',
        },
      ),
      update: jest
        .fn()
        .mockResolvedValue({ amountPaid: '500', status: 'PAID' }),
    };
    const event = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        organization: { country: 'KE' },
        currency: 'KES',
      }),
    };
    const prisma = {
      transaction,
      invoice,
      event,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;

    return { prisma, transaction, invoice };
  }

  function makeProviders(verifyTransaction: jest.Mock) {
    return {
      byName: jest.fn().mockReturnValue({ verifyTransaction }),
    } as unknown as PaymentProviderRegistry;
  }

  it('is a no-op when the providerReference has already been processed', async () => {
    const { prisma, transaction } = makePrismaMock({
      existingTransaction: { id: 'existing-tx' },
    });
    const verifyTransaction = jest.fn();
    const providers = makeProviders(verifyTransaction);
    const processor = new WebhookProcessor(prisma, audit, providers);

    await processor.process(makeJob());

    expect(transaction.create).not.toHaveBeenCalled();
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it('refuses to credit when gateway verification does not confirm SUCCESS', async () => {
    const { prisma, transaction } = makePrismaMock();
    const verifyTransaction = jest.fn().mockResolvedValue({
      status: TransactionStatus.FAILED,
      amountSettled: 500,
    });
    const providers = makeProviders(verifyTransaction);
    const processor = new WebhookProcessor(prisma, audit, providers);

    await expect(processor.process(makeJob())).rejects.toThrow(
      /refusing to credit/,
    );
    expect(transaction.create).not.toHaveBeenCalled();
  });

  it('credits the invoice with the net amount and persists the platform fee separately', async () => {
    const { prisma, transaction, invoice } = makePrismaMock();
    // The gateway always reports the gross (base + fee) amount actually charged.
    const verifyTransaction = jest.fn().mockResolvedValue({
      status: TransactionStatus.SUCCESS,
      amountSettled: 515,
    });
    const providers = makeProviders(verifyTransaction);
    const processor = new WebhookProcessor(prisma, audit, providers);

    await processor.process(
      makeJob({ amountSettled: 515, platformFeeAmount: 15 }),
    );

    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountSettled: 500,
          platformFeeAmount: 15,
        }),
      }),
    );
    expect(invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountPaid: { increment: 500 } }),
      }),
    );
  });

  it('treats a missing platformFeeAmount as zero (manual/no-fee webhooks)', async () => {
    const { prisma, transaction } = makePrismaMock();
    const verifyTransaction = jest.fn().mockResolvedValue({
      status: TransactionStatus.SUCCESS,
      amountSettled: 500,
    });
    const providers = makeProviders(verifyTransaction);
    const processor = new WebhookProcessor(prisma, audit, providers);

    await processor.process(makeJob({ amountSettled: 500 }));

    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountSettled: 500,
          platformFeeAmount: 0,
        }),
      }),
    );
  });
});
