import { EventReportsService } from './event-reports.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('EventReportsService.generateCloseoutCsv', () => {
  function makePrisma(opts: {
    title?: string;
    totalReceived?: number | null;
    totalAllocatable?: number | null;
    categories?: Record<string, unknown>[];
    disbursements?: Record<string, unknown>[];
  }) {
    const transactionAggregate = jest.fn(
      (args: { where: { paymentRail?: unknown } }) => {
        const isAllocatable = !!args.where.paymentRail;
        return Promise.resolve({
          _sum: {
            amountSettled: isAllocatable
              ? (opts.totalAllocatable ?? opts.totalReceived ?? null)
              : (opts.totalReceived ?? null),
          },
        });
      },
    );
    return {
      event: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ title: opts.title ?? 'Test Event' }),
      },
      transaction: { aggregate: transactionAggregate },
      budgetCategory: {
        findMany: jest.fn().mockResolvedValue(opts.categories ?? []),
      },
      disbursement: {
        findMany: jest.fn().mockResolvedValue(opts.disbursements ?? []),
      },
    } as unknown as PrismaService;
  }

  it('includes the event title and totals in the header rows', async () => {
    const prisma = makePrisma({
      title: 'Grace Wedding',
      totalReceived: 1000,
      totalAllocatable: 800,
    });
    const service = new EventReportsService(prisma);

    const { csv, filename } = await service.generateCloseoutCsv('event-1');

    expect(csv).toContain('Close-out report,Grace Wedding');
    expect(csv).toContain(
      'Total received (all contributions incl. manual/off-app),1000',
    );
    expect(csv).toContain('Total allocatable (real gateway-settled money),800');
    expect(filename).toMatch(/^closeout-grace-wedding-event-1\.csv$/);
  });

  it('sums allocatedFunds across categories for the total-allocated row', async () => {
    const prisma = makePrisma({
      categories: [
        {
          id: 'cat-1',
          name: 'Venue',
          estimatedCost: { toString: () => '500' },
          allocatedFunds: '300',
          vendor: null,
        },
        {
          id: 'cat-2',
          name: 'Catering',
          estimatedCost: { toString: () => '200' },
          allocatedFunds: '150',
          vendor: { name: 'Chef Co' },
        },
      ],
    });
    const service = new EventReportsService(prisma);

    const { csv } = await service.generateCloseoutCsv('event-1');

    expect(csv).toContain('Total allocated to budget categories,450');
    expect(csv).toContain('Venue,500,300,0,');
    expect(csv).toContain('Catering,200,150,0,Chef Co');
  });

  it('attributes paid-out amounts to the right category, counting only PENDING/QUEUED/SUCCESS disbursements', async () => {
    const prisma = makePrisma({
      categories: [
        {
          id: 'cat-1',
          name: 'Venue',
          estimatedCost: { toString: () => '500' },
          allocatedFunds: '500',
          vendor: { name: 'Venue Co' },
        },
      ],
      disbursements: [
        {
          budgetCategoryId: 'cat-1',
          status: 'SUCCESS',
          amount: { toString: () => '300' },
          recipientName: 'Venue Co',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          failureReason: null,
        },
        {
          budgetCategoryId: 'cat-1',
          status: 'FAILED',
          amount: { toString: () => '500' },
          recipientName: 'Venue Co',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          failureReason: 'insufficient balance',
        },
      ],
    });
    const service = new EventReportsService(prisma);

    const { csv } = await service.generateCloseoutCsv('event-1');

    // Only the SUCCESS disbursement (300) counts toward "paid out" — the
    // FAILED one never actually sent money.
    expect(csv).toContain('Venue,500,500,300,Venue Co');
    expect(csv).toContain('Venue Co,300,SUCCESS,2026-01-01T00:00:00.000Z,');
    expect(csv).toContain(
      'Venue Co,500,FAILED,2026-01-02T00:00:00.000Z,insufficient balance',
    );
  });

  it('defaults missing totals to zero, not null', async () => {
    const prisma = makePrisma({ totalReceived: null, totalAllocatable: null });
    const service = new EventReportsService(prisma);

    const { csv } = await service.generateCloseoutCsv('event-1');

    expect(csv).toContain(
      'Total received (all contributions incl. manual/off-app),0',
    );
    expect(csv).toContain('Total allocatable (real gateway-settled money),0');
  });
});
