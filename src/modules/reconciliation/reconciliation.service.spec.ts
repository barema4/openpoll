import { ReconciliationService } from './reconciliation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PaystackProvider } from '../payments/providers/paystack.provider';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';
import type { StripeProvider } from '../payments/providers/stripe.provider';

function makePrisma(opts: {
  kenyaFees?: number | null;
  ugandaReceived?: number | null;
  ugandaWithdrawn?: number | null;
  ugandaDisbursed?: number | null;
  ugandaFees?: number | null;
  stripeFees?: number | null;
}) {
  const aggregateCalls: unknown[] = [];
  return {
    transaction: {
      aggregate: jest.fn((args: unknown) => {
        aggregateCalls.push(args);
        // Order matches ReconciliationService.check()'s Promise.all:
        // Kenya fees, then (Uganda) received, then Uganda fees, then
        // Stripe fees.
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
        if (aggregateCalls.length === 3) {
          return Promise.resolve({
            _sum: { platformFeeAmount: opts.ugandaFees ?? null },
          });
        }
        return Promise.resolve({
          _sum: { platformFeeAmount: opts.stripeFees ?? null },
        });
      }),
    },
    withdrawal: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: opts.ugandaWithdrawn ?? null },
      }),
    },
    disbursement: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: opts.ugandaDisbursed ?? null },
      }),
    },
  } as unknown as PrismaService;
}

function makeProviders(opts: {
  kenyaBalances?: { currency: string; balance: number }[];
  ugandaBalances?: { country: string; currency: string; balance: number }[];
  stripeBalances?: { currency: string; balance: number }[];
}) {
  const paystack = {
    getBalance: jest.fn().mockResolvedValue(opts.kenyaBalances ?? []),
  } as unknown as PaystackProvider;
  const pawapay = {
    getBalance: jest.fn().mockResolvedValue(opts.ugandaBalances ?? []),
  } as unknown as PawaPayProvider;
  const stripe = {
    getBalance: jest.fn().mockResolvedValue(opts.stripeBalances ?? []),
  } as unknown as StripeProvider;
  return { paystack, pawapay, stripe };
}

describe('ReconciliationService', () => {
  it('reports the Kenya live balance alongside expected platform fees and a caveat', async () => {
    const prisma = makePrisma({ kenyaFees: 500 });
    const { paystack, pawapay, stripe } = makeProviders({
      kenyaBalances: [{ currency: 'KES', balance: 1200 }],
    });
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

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
    const { paystack, pawapay, stripe } = makeProviders({
      ugandaBalances: [{ country: 'UGA', currency: 'UGX', balance: 7150 }],
    });
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

    const report = await service.check();

    // owed to orgs = 10000 - 3000 = 7000; + fees 150 = expected 7150.
    expect(report.uganda.totalOwedToOrgs).toBe(7000);
    expect(report.uganda.totalPlatformFees).toBe(150);
    expect(report.uganda.expectedTotal).toBe(7150);
    expect(report.uganda.drift).toBe(0);
  });

  it('subtracts vendor payouts already sent or in flight (Disbursement) from what is owed to orgs', async () => {
    const prisma = makePrisma({
      ugandaReceived: 10000,
      ugandaWithdrawn: 1000,
      ugandaDisbursed: 4000,
      ugandaFees: 0,
    });
    const { paystack, pawapay, stripe } = makeProviders({
      ugandaBalances: [{ country: 'UGA', currency: 'UGX', balance: 5000 }],
    });
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

    const report = await service.check();

    // owed to orgs = 10000 - 1000 - 4000 = 5000.
    expect(report.uganda.totalOwedToOrgs).toBe(5000);
    expect(report.uganda.drift).toBe(0);
  });

  it('surfaces a nonzero drift when the live balance does not match expectations', async () => {
    const prisma = makePrisma({
      ugandaReceived: 10000,
      ugandaWithdrawn: 0,
      ugandaFees: 0,
    });
    const { paystack, pawapay, stripe } = makeProviders({
      ugandaBalances: [{ country: 'UGA', currency: 'UGX', balance: 9000 }],
    });
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

    const report = await service.check();

    expect(report.uganda.expectedTotal).toBe(10000);
    expect(report.uganda.drift).toBe(-1000);
  });

  it('reports the Stripe live balance alongside expected platform fees across every Stripe-backed country', async () => {
    const prisma = makePrisma({ stripeFees: 42 });
    const { paystack, pawapay, stripe } = makeProviders({
      stripeBalances: [{ currency: 'USD', balance: 300 }],
    });
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

    const report = await service.check();

    expect(report.stripe.liveBalances).toEqual([
      { currency: 'USD', balance: 300 },
    ]);
    expect(report.stripe.expectedPlatformFees).toBe(42);
    expect(report.stripe.caveat).toMatch(/approximate/i);
  });

  it('treats no transactions/withdrawals/fees as zero, not null', async () => {
    const prisma = makePrisma({});
    const { paystack, pawapay, stripe } = makeProviders({});
    const service = new ReconciliationService(
      prisma,
      paystack,
      pawapay,
      stripe,
    );

    const report = await service.check();

    expect(report.kenya.expectedPlatformFees).toBe(0);
    expect(report.uganda.expectedTotal).toBe(0);
    expect(report.uganda.drift).toBe(0);
    expect(report.stripe.expectedPlatformFees).toBe(0);
  });
});
