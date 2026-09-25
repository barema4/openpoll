import { BadRequestException, ConflictException } from '@nestjs/common';
import { PlatformPayoutsService } from './platform-payouts.service';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

const countryCode = 'UG';
const audit = { record: jest.fn() } as unknown as AuditService;

function makePrisma(opts: {
  totalFees?: number | null;
  totalWithdrawn?: number | null;
  destination?: {
    payoutMobileProvider: string;
    payoutMobileNumber: string;
  } | null;
}) {
  const transactionAggregate = jest.fn().mockResolvedValue({
    _sum: { platformFeeAmount: opts.totalFees ?? null },
  });
  const platformWithdrawalAggregate = jest.fn().mockResolvedValue({
    _sum: { amount: opts.totalWithdrawn ?? null },
  });
  const platformWithdrawalCreate = jest
    .fn()
    .mockResolvedValue({ id: 'platform-withdrawal-1' });

  const txHandle = {
    transaction: { aggregate: transactionAggregate },
    platformWithdrawal: {
      aggregate: platformWithdrawalAggregate,
      create: platformWithdrawalCreate,
    },
  };

  return {
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txHandle)),
    transaction: { aggregate: transactionAggregate },
    platformWithdrawal: {
      aggregate: platformWithdrawalAggregate,
      create: platformWithdrawalCreate,
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'platform-withdrawal-1',
        status: 'PROCESSING',
      }),
    },
    platformPayoutDestination: {
      findUnique: jest.fn().mockResolvedValue(
        opts.destination === undefined
          ? {
              payoutMobileProvider: 'MTN_MOMO_UGA',
              payoutMobileNumber: '256771234567',
            }
          : opts.destination,
      ),
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

describe('PlatformPayoutsService.getBalance', () => {
  it('is accumulated platform fees minus already-withdrawn (processing + completed)', async () => {
    const prisma = makePrisma({ totalFees: 1000, totalWithdrawn: 400 });
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    expect(await service.getBalance(countryCode)).toBe(600);
  });

  it('treats no fees/withdrawals as zero, not null', async () => {
    const prisma = makePrisma({ totalFees: null, totalWithdrawn: null });
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    expect(await service.getBalance(countryCode)).toBe(0);
  });
});

describe('PlatformPayoutsService.setDestination', () => {
  it('rejects an unsupported country code', async () => {
    const prisma = makePrisma({});
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.setDestination('user-1', 'US', {
        provider: 'MTN_MOMO_UGA',
        phoneNumber: '256771234567',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an operator that doesn't belong to the country", async () => {
    const prisma = makePrisma({});
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.setDestination('user-1', 'KE', {
        provider: 'MTN_MOMO_UGA',
        phoneNumber: '256771234567',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts the destination and masks the phone number in the response', async () => {
    const upsert = jest.fn().mockResolvedValue({
      countryCode: 'UG',
      payoutMobileProvider: 'MTN_MOMO_UGA',
      payoutMobileNumber: '256771234567',
    });
    const prisma = {
      platformPayoutDestination: { upsert },
    } as unknown as PrismaService;
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    const result = await service.setDestination('user-1', 'UG', {
      provider: 'MTN_MOMO_UGA',
      phoneNumber: '256771234567',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { countryCode: 'UG' } }),
    );
    expect(result).not.toHaveProperty('payoutMobileNumber');
    expect(result).toMatchObject({ payoutMobileNumberLast4: '4567' });
  });
});

describe('PlatformPayoutsService.requestWithdrawal', () => {
  it('rejects an unsupported country code', async () => {
    const prisma = makePrisma({});
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', 'US', 100),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when no payout destination is set for the country', async () => {
    const prisma = makePrisma({ destination: null });
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', countryCode, 100),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an amount exceeding the available platform fee balance', async () => {
    const prisma = makePrisma({ totalFees: 100, totalWithdrawn: 0 });
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', countryCode, 500),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the withdrawal and marks it PROCESSING when PawaPay accepts the payout', async () => {
    const prisma = makePrisma({ totalFees: 1000, totalWithdrawn: 0 });
    const initiatePayout = jest
      .fn()
      .mockResolvedValue({ payoutId: 'payout-1', accepted: true });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new PlatformPayoutsService(prisma, audit, pawapay);

    await service.requestWithdrawal('user-1', countryCode, 500);

    expect(initiatePayout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        currency: 'UGX',
        phoneNumber: '256771234567',
        provider: 'MTN_MOMO_UGA',
      }),
    );
    const updateMock = (
      prisma as unknown as { platformWithdrawal: { update: jest.Mock } }
    ).platformWithdrawal.update;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
  });

  it('marks the withdrawal FAILED when PawaPay rejects the payout', async () => {
    const prisma = makePrisma({ totalFees: 1000, totalWithdrawn: 0 });
    const initiatePayout = jest.fn().mockResolvedValue({
      payoutId: 'payout-1',
      accepted: false,
      failureMessage: 'insufficient balance',
    });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new PlatformPayoutsService(prisma, audit, pawapay);

    await service.requestWithdrawal('user-1', countryCode, 500);

    const updateMock = (
      prisma as unknown as { platformWithdrawal: { update: jest.Mock } }
    ).platformWithdrawal.update;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'insufficient balance',
        }),
      }),
    );
  });

  it('rejects with a 409 when a concurrent withdrawal request wins the race', async () => {
    const prisma = makePrisma({ totalFees: 1000, totalWithdrawn: 0 });
    (
      prisma as unknown as { $transaction: jest.Mock }
    ).$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await expect(
      service.requestWithdrawal('user-1', countryCode, 500),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PlatformPayoutsService.completeWithdrawal', () => {
  it('marks COMPLETED and audit-logs it', async () => {
    const update = jest.fn().mockResolvedValue({});
    const auditRecord = jest.fn();
    const prisma = {
      platformWithdrawal: { update },
    } as unknown as PrismaService;
    const service = new PlatformPayoutsService(
      prisma,
      { record: auditRecord } as unknown as AuditService,
      {} as PawaPayProvider,
    );

    await service.completeWithdrawal(
      { id: 'pw-1', countryCode: 'UG', status: 'PROCESSING' },
      true,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pw-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PLATFORM_WITHDRAWAL_COMPLETED' }),
    );
  });

  it('does nothing for an already-resolved withdrawal (redelivered callback)', async () => {
    const update = jest.fn();
    const prisma = {
      platformWithdrawal: { update },
    } as unknown as PrismaService;
    const service = new PlatformPayoutsService(
      prisma,
      audit,
      {} as PawaPayProvider,
    );

    await service.completeWithdrawal(
      { id: 'pw-1', countryCode: 'UG', status: 'COMPLETED' },
      true,
    );

    expect(update).not.toHaveBeenCalled();
  });
});
