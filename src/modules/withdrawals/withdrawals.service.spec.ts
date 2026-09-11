import { BadRequestException } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { OrganizationCountry } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

const organizationId = 'org-1';
const audit = { record: jest.fn() } as unknown as AuditService;

function makePrisma(opts: {
  totalReceived?: number | null;
  totalWithdrawn?: number | null;
  country?: OrganizationCountry;
  payoutMobileProvider?: string | null;
  payoutMobileNumber?: string | null;
}) {
  return {
    transaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amountSettled: opts.totalReceived ?? null },
      }),
    },
    withdrawal: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: opts.totalWithdrawn ?? null },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'withdrawal-1' }),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'withdrawal-1', status: 'PROCESSING' }),
    },
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
});
