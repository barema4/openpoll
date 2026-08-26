import { PersonalInvoiceWebhookProcessor } from './personal-invoice-webhook.processor';
import {
  TransactionStatus,
  PaymentRail,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PaymentProvider } from '../payments/providers/payment-provider.interface';
import type { Job } from 'bullmq';

describe('PersonalInvoiceWebhookProcessor', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  function makeJob(overrides: Record<string, unknown> = {}) {
    return {
      data: {
        eventType: 'charge.success',
        providerReference: 'ref-1',
        amountSettled: 500,
        status: TransactionStatus.SUCCESS,
        paymentRail: PaymentRail.CARD,
        personalInvoiceId: 'pi-1',
        ...overrides,
      },
    } as unknown as Job;
  }

  function makePrismaMock(existingTransaction: unknown = null) {
    const personalInvoiceTransaction = {
      findUnique: jest.fn().mockResolvedValue(existingTransaction),
      create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };
    const personalInvoice = { updateMany: jest.fn() };
    const prisma = {
      personalInvoiceTransaction,
      personalInvoice,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;

    return { prisma, personalInvoiceTransaction, personalInvoice };
  }

  it('is a no-op when the providerReference has already been processed', async () => {
    const { prisma, personalInvoiceTransaction } = makePrismaMock({
      id: 'existing-tx',
    });
    const verifyTransaction = jest.fn();
    const provider = { verifyTransaction } as unknown as PaymentProvider;
    const processor = new PersonalInvoiceWebhookProcessor(
      prisma,
      audit,
      provider,
    );

    await processor.process(makeJob());

    expect(personalInvoiceTransaction.create).not.toHaveBeenCalled();
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it('refuses to credit when gateway verification does not confirm SUCCESS', async () => {
    const { prisma, personalInvoiceTransaction } = makePrismaMock();
    const verifyTransaction = jest.fn().mockResolvedValue({
      status: TransactionStatus.FAILED,
      amountSettled: 500,
    });
    const provider = { verifyTransaction } as unknown as PaymentProvider;
    const processor = new PersonalInvoiceWebhookProcessor(
      prisma,
      audit,
      provider,
    );

    await expect(processor.process(makeJob())).rejects.toThrow(
      /refusing to credit/,
    );
    expect(personalInvoiceTransaction.create).not.toHaveBeenCalled();
  });

  it('creates a transaction and marks the invoice PAID on verified success', async () => {
    const { prisma, personalInvoiceTransaction, personalInvoice } =
      makePrismaMock();
    const verifyTransaction = jest.fn().mockResolvedValue({
      status: TransactionStatus.SUCCESS,
      amountSettled: 500,
    });
    const provider = { verifyTransaction } as unknown as PaymentProvider;
    const processor = new PersonalInvoiceWebhookProcessor(
      prisma,
      audit,
      provider,
    );

    await processor.process(makeJob());

    expect(personalInvoiceTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          personalInvoiceId: 'pi-1',
          providerReference: 'ref-1',
        }),
      }),
    );
    expect(personalInvoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pi-1', status: { not: 'PAID' } },
      }),
    );
  });
});
