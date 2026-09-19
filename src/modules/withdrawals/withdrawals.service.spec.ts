import { BadRequestException, ConflictException } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  OrganizationCountry,
  PaymentRail,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

const organizationId = 'org-1';
const audit = { record: jest.fn() } as unknown as AuditService;

// reserveWithdrawal() runs the balance check + Withdrawal creation inside
// prisma.$transaction — $transaction here just invokes the callback with
// the very same mock functions as the top-level prisma object, so a test
// can assert against either handle interchangeably.
function makePrisma(opts: {
  totalReceived?: number | null;
  totalWithdrawn?: number | null;
  totalDisbursed?: number | null;
  country?: OrganizationCountry;
  payoutMobileProvider?: string | null;
  payoutMobileNumber?: string | null;
}) {
  const transactionAggregate = jest.fn().mockResolvedValue({
    _sum: { amountSettled: opts.totalReceived ?? null },
  });
  const withdrawalAggregate = jest.fn().mockResolvedValue({
    _sum: { amount: opts.totalWithdrawn ?? null },
  });
  const withdrawalCreate = jest.fn().mockResolvedValue({ id: 'withdrawal-1' });
  const disbursementAggregate = jest.fn().mockResolvedValue({
    _sum: { amount: opts.totalDisbursed ?? null },
  });

  const txHandle = {
    transaction: { aggregate: transactionAggregate },
    withdrawal: { aggregate: withdrawalAggregate, create: withdrawalCreate },
    disbursement: { aggregate: disbursementAggregate },
  };

  return {
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txHandle)),
    transaction: { aggregate: transactionAggregate },
    withdrawal: {
      aggregate: withdrawalAggregate,
      findMany: jest.fn().mockResolvedValue([]),
      create: withdrawalCreate,
      update: jest
        .fn()
        .mockResolvedValue({ id: 'withdrawal-1', status: 'PROCESSING' }),
    },
    disbursement: { aggregate: disbursementAggregate },
    organization: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        country: opts.country ?? OrganizationCountry.UGANDA,
        payoutMobileProvider: opts.payoutMobileProvider ?? 'MTN_MOMO_UGA',
        payoutMobileNumber: opts.payoutMobileNumber ?? '256771234567',
      }),
    },
  } as unknown as PrismaService;
}

describe('WithdrawalsService.getBalance', () => {
  it('is total received minus total withdrawn (processing + completed)', async () => {
    const prisma = makePrisma({ totalReceived: 10000, totalWithdrawn: 4000 });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    expect(await service.getBalance(organizationId)).toBe(6000);
  });

  it('treats no transactions/withdrawals as zero, not null', async () => {
    const prisma = makePrisma({ totalReceived: null, totalWithdrawn: null });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    expect(await service.getBalance(organizationId)).toBe(0);
  });

  it('also subtracts vendor payouts already sent or in flight (Disbursement)', async () => {
    const prisma = makePrisma({
      totalReceived: 10000,
      totalWithdrawn: 1000,
      totalDisbursed: 4000,
    });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    expect(await service.getBalance(organizationId)).toBe(5000);
  });

  it('excludes manual (off-app) contributions from the withdrawable balance', async () => {
    const prisma = makePrisma({ totalReceived: 10000, totalWithdrawn: 0 });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await service.getBalance(organizationId);

    const aggregateMock = (
      prisma as unknown as { transaction: { aggregate: jest.Mock } }
    ).transaction.aggregate;
    expect(aggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentRail: { not: PaymentRail.MANUAL },
        }),
      }),
    );
  });
});

describe('WithdrawalsService.requestWithdrawal', () => {
  it('rejects a Kenya organization outright', async () => {
    const prisma = makePrisma({ country: OrganizationCountry.KENYA });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', organizationId, { amount: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when no mobile money payout destination is set', async () => {
    const prisma = makePrisma({
      payoutMobileProvider: null,
      payoutMobileNumber: null,
    });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', organizationId, { amount: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an amount exceeding the available balance', async () => {
    const prisma = makePrisma({ totalReceived: 1000, totalWithdrawn: 0 });
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', organizationId, { amount: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the withdrawal and marks it PROCESSING when PawaPay accepts the payout', async () => {
    const prisma = makePrisma({ totalReceived: 1000, totalWithdrawn: 0 });
    const initiatePayout = jest
      .fn()
      .mockResolvedValue({ payoutId: 'payout-1', accepted: true });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new WithdrawalsService(prisma, audit, pawapay);

    await service.requestWithdrawal('user-1', organizationId, { amount: 500 });

    expect(initiatePayout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        currency: 'UGX',
        phoneNumber: '256771234567',
        provider: 'MTN_MOMO_UGA',
      }),
    );
    const updateMock = (
      prisma as unknown as { withdrawal: { update: jest.Mock } }
    ).withdrawal.update;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
  });

  it('marks the withdrawal FAILED when PawaPay rejects the payout', async () => {
    const prisma = makePrisma({ totalReceived: 1000, totalWithdrawn: 0 });
    const initiatePayout = jest.fn().mockResolvedValue({
      payoutId: 'payout-1',
      accepted: false,
      failureMessage: 'insufficient balance',
    });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new WithdrawalsService(prisma, audit, pawapay);

    await service.requestWithdrawal('user-1', organizationId, { amount: 500 });

    const updateMock = (
      prisma as unknown as { withdrawal: { update: jest.Mock } }
    ).withdrawal.update;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'insufficient balance',
        }),
      }),
    );
  });

  it('rejects with a 409 when a concurrent withdrawal request wins the race (Postgres serialization failure)', async () => {
    const prisma = makePrisma({ totalReceived: 1000, totalWithdrawn: 0 });
    (
      prisma as unknown as { $transaction: jest.Mock }
    ).$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', organizationId, { amount: 500 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects with a 409 for the real DriverAdapterError shape @prisma/adapter-pg actually throws on conflict', async () => {
    const prisma = makePrisma({ totalReceived: 1000, totalWithdrawn: 0 });
    const conflict = new Error('TransactionWriteConflict');
    conflict.name = 'DriverAdapterError';
    (conflict as unknown as { cause: { kind: string } }).cause = {
      kind: 'TransactionWriteConflict',
    };
    (
      prisma as unknown as { $transaction: jest.Mock }
    ).$transaction.mockRejectedValue(conflict);
    const service = new WithdrawalsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', organizationId, { amount: 500 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
