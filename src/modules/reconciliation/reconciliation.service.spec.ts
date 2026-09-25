import { ReconciliationService } from './reconciliation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

interface CountryFigures {
  received?: number | null;
  withdrawn?: number | null;
  disbursed?: number | null;
  fees?: number | null;
  platformWithdrawn?: number | null;
}

// check() runs one checkPawaPayCountry() per PawaPay-backed country (~20
// today) in parallel, so mocks are keyed by the actual country code found
// in each call's `where` clause rather than by call order — the only way
// to stay correct regardless of how many countries SUPPORTED_COUNTRIES
// adds later.
function makePrisma(figuresByCountry: Record<string, CountryFigures>) {
  const transactionAggregate = jest.fn(
    (args: { where: { event?: { organization?: { country?: string } } } }) => {
      const country = args.where.event?.organization?.country ?? '';
      const figures = figuresByCountry[country] ?? {};
      if ('paymentRail' in args.where) {
        return Promise.resolve({
          _sum: { amountSettled: figures.received ?? null },
        });
      }
      return Promise.resolve({
        _sum: { platformFeeAmount: figures.fees ?? null },
      });
    },
  );
  const withdrawalAggregate = jest.fn(
    (args: { where: { organization?: { country?: string } } }) => {
      const country = args.where.organization?.country ?? '';
      return Promise.resolve({
        _sum: { amount: figuresByCountry[country]?.withdrawn ?? null },
      });
    },
  );
  const disbursementAggregate = jest.fn(
    (args: { where: { event?: { organization?: { country?: string } } } }) => {
      const country = args.where.event?.organization?.country ?? '';
      return Promise.resolve({
        _sum: { amount: figuresByCountry[country]?.disbursed ?? null },
      });
    },
  );
  const platformWithdrawalAggregate = jest.fn(
    (args: { where: { countryCode?: string } }) => {
      const country = args.where.countryCode ?? '';
      return Promise.resolve({
        _sum: { amount: figuresByCountry[country]?.platformWithdrawn ?? null },
      });
    },
  );
  return {
    transaction: { aggregate: transactionAggregate },
    withdrawal: { aggregate: withdrawalAggregate },
    disbursement: { aggregate: disbursementAggregate },
    platformWithdrawal: { aggregate: platformWithdrawalAggregate },
  } as unknown as PrismaService;
}

function makeProviders(opts: {
  balancesByAlpha3?: Record<
    string,
    { country: string; currency: string; balance: number }[]
  >;
}) {
  const pawapay = {
    getBalance: jest.fn((alpha3: string) =>
      Promise.resolve(opts.balancesByAlpha3?.[alpha3] ?? []),
    ),
  } as unknown as PawaPayProvider;
  return { pawapay };
}

describe('ReconciliationService', () => {
  it('computes Uganda drift as liveBalance minus (owed to orgs + platform fees)', async () => {
    const prisma = makePrisma({
      UG: { received: 10000, withdrawn: 3000, fees: 150 },
    });
    const { pawapay } = makeProviders({
      balancesByAlpha3: {
        UGA: [{ country: 'UGA', currency: 'UGX', balance: 7150 }],
      },
    });
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const uganda = report.pawapay.find((c) => c.countryCode === 'UG')!;

    // owed to orgs = 10000 - 3000 = 7000; + fees 150 = expected 7150.
    expect(uganda.totalOwedToOrgs).toBe(7000);
    expect(uganda.totalPlatformFees).toBe(150);
    expect(uganda.expectedTotal).toBe(7150);
    expect(uganda.drift).toBe(0);
  });

  it('computes Kenya drift the same exact way, now that Kenya is PawaPay-backed too', async () => {
    const prisma = makePrisma({
      KE: { received: 5000, withdrawn: 1000, fees: 75 },
    });
    const { pawapay } = makeProviders({
      balancesByAlpha3: {
        KEN: [{ country: 'KEN', currency: 'KES', balance: 4075 }],
      },
    });
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const kenya = report.pawapay.find((c) => c.countryCode === 'KE')!;

    // owed to orgs = 5000 - 1000 = 4000; + fees 75 = expected 4075.
    expect(kenya.totalOwedToOrgs).toBe(4000);
    expect(kenya.expectedTotal).toBe(4075);
    expect(kenya.drift).toBe(0);
  });

  it('subtracts vendor payouts already sent or in flight (Disbursement) from what is owed to orgs', async () => {
    const prisma = makePrisma({
      UG: { received: 10000, withdrawn: 1000, disbursed: 4000, fees: 0 },
    });
    const { pawapay } = makeProviders({
      balancesByAlpha3: {
        UGA: [{ country: 'UGA', currency: 'UGX', balance: 5000 }],
      },
    });
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const uganda = report.pawapay.find((c) => c.countryCode === 'UG')!;

    // owed to orgs = 10000 - 1000 - 4000 = 5000.
    expect(uganda.totalOwedToOrgs).toBe(5000);
    expect(uganda.drift).toBe(0);
  });

  it('surfaces a nonzero drift when the live balance does not match expectations', async () => {
    const prisma = makePrisma({
      UG: { received: 10000, withdrawn: 0, fees: 0 },
    });
    const { pawapay } = makeProviders({
      balancesByAlpha3: {
        UGA: [{ country: 'UGA', currency: 'UGX', balance: 9000 }],
      },
    });
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const uganda = report.pawapay.find((c) => c.countryCode === 'UG')!;

    expect(uganda.expectedTotal).toBe(10000);
    expect(uganda.drift).toBe(-1000);
  });

  it('treats no transactions/withdrawals/fees as zero, not null', async () => {
    const prisma = makePrisma({});
    const { pawapay } = makeProviders({});
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const uganda = report.pawapay.find((c) => c.countryCode === 'UG')!;

    expect(uganda.expectedTotal).toBe(0);
    expect(uganda.drift).toBe(0);
  });

  it('subtracts already-withdrawn platform fees from what is still expected in the wallet', async () => {
    const prisma = makePrisma({
      UG: {
        received: 10000,
        withdrawn: 3000,
        fees: 150,
        platformWithdrawn: 100,
      },
    });
    const { pawapay } = makeProviders({
      balancesByAlpha3: {
        // 7000 owed to orgs + (150 fees - 100 already withdrawn) = 7050.
        UGA: [{ country: 'UGA', currency: 'UGX', balance: 7050 }],
      },
    });
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();
    const uganda = report.pawapay.find((c) => c.countryCode === 'UG')!;

    expect(uganda.totalPlatformFees).toBe(150);
    expect(uganda.totalPlatformFeesWithdrawn).toBe(100);
    expect(uganda.platformFeesAvailable).toBe(50);
    expect(uganda.expectedTotal).toBe(7050);
    expect(uganda.drift).toBe(0);
  });

  it('checks every PawaPay-backed country, not just Kenya and Uganda', async () => {
    const prisma = makePrisma({});
    const { pawapay } = makeProviders({});
    const service = new ReconciliationService(prisma, pawapay);

    const report = await service.check();

    const codes = report.pawapay.map((c) => c.countryCode);
    expect(codes).toEqual(expect.arrayContaining(['KE', 'UG', 'GH', 'TZ']));
    expect(codes.length).toBeGreaterThan(10);
  });
});
