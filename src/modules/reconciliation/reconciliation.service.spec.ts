import { ReconciliationService } from './reconciliation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PaystackProvider } from '../payments/providers/paystack.provider';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

function makePrisma(opts: {
  kenyaFees?: number | null;
  ugandaReceived?: number | null;
  ugandaWithdrawn?: number | null;
  ugandaFees?: number | null;
}) {
  const aggregateCalls: unknown[] = [];
  return {
    transaction: {
      aggregate: jest.fn((args: unknown) => {
        aggregateCalls.push(args);
        // Order matches ReconciliationService: Kenya fees, then (Uganda)
        // received, then Uganda fees.
        if (aggregateCalls.length === 1) {
          return Promise.resolve({
            _sum: { platformFeeAmount: opts.kenyaFees ?? null },
          });
        }
        if (aggregateCalls.length === 2) {
          return Promise.resolve({
            _sum: { amountSettled: opts.ugandaReceived ?? null },
          });
        }
        return Promise.resolve({
          _sum: { platformFeeAmount: opts.ugandaFees ?? null },
        });
      }),
    },
    withdrawal: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: opts.ugandaWithdrawn ?? null },
      }),
    },
  } as unknown as PrismaService;
}

describe('ReconciliationService', () => {
  it('reports the Kenya live balance alongside expected platform fees and a caveat', async () => {
    const prisma = makePrisma({ kenyaFees: 500 });
    const paystack = {
      getBalance: jest
        .fn()
        .mockResolvedValue([{ currency: 'KES', balance: 1200 }]),
    } as unknown as PaystackProvider;
    const pawapay = {
      getBalance: jest
        .fn()
        .mockResolvedValue([{ country: 'UGA', currency: 'UGX', balance: 0 }]),
    } as unknown as PawaPayProvider;
    const service = new ReconciliationService(prisma, paystack, pawapay);

    const report = await service.check();

    expect(report.kenya.liveBalances).toEqual([
      { currency: 'KES', balance: 1200 },
    ]);
    expect(report.kenya.expectedPlatformFees).toBe(500);
    expect(report.kenya.caveat).toMatch(/approximate/i);
  });

  it('computes Uganda drift as liveBalance minus (owed to orgs + platform fees)', async () => {
    const prisma = makePrisma({
      ugandaReceived: 10000,
      ugandaWithdrawn: 3000,
      ugandaFees: 150,
    });
    const paystack = {
      getBalance: jest.fn().mockResolvedValue([]),
    } as unknown as PaystackProvider;
    const pawapay = {
      getBalance: jest
        .fn()
        .mockResolvedValue([
          { country: 'UGA', currency: 'UGX', balance: 7150 },
        ]),
    } as unknown as PawaPayProvider;
    const service = new ReconciliationService(prisma, paystack, pawapay);

    const report = await service.check();

    // owed to orgs = 10000 - 3000 = 7000; + fees 150 = expected 7150.
    expect(report.uganda.totalOwedToOrgs).toBe(7000);
    expect(report.uganda.totalPlatformFees).toBe(150);
    expect(report.uganda.expectedTotal).toBe(7150);
    expect(report.uganda.drift).toBe(0);
  });

  it('surfaces a nonzero drift when the live balance does not match expectations', async () => {
    const prisma = makePrisma({
      ugandaReceived: 10000,
      ugandaWithdrawn: 0,
      ugandaFees: 0,
    });
    const paystack = {
      getBalance: jest.fn().mockResolvedValue([]),
    } as unknown as PaystackProvider;
    const pawapay = {
      getBalance: jest
        .fn()
        .mockResolvedValue([
          { country: 'UGA', currency: 'UGX', balance: 9000 },
        ]),
    } as unknown as PawaPayProvider;
    const service = new ReconciliationService(prisma, paystack, pawapay);

    const report = await service.check();

    expect(report.uganda.expectedTotal).toBe(10000);
    expect(report.uganda.drift).toBe(-1000);
  });

  it('treats no transactions/withdrawals/fees as zero, not null', async () => {
    const prisma = makePrisma({});
    const paystack = {
      getBalance: jest.fn().mockResolvedValue([]),
    } as unknown as PaystackProvider;
    const pawapay = {
      getBalance: jest.fn().mockResolvedValue([]),
    } as unknown as PawaPayProvider;
    const service = new ReconciliationService(prisma, paystack, pawapay);

    const report = await service.check();

    expect(report.kenya.expectedPlatformFees).toBe(0);
    expect(report.uganda.expectedTotal).toBe(0);
    expect(report.uganda.drift).toBe(0);
  });
});
