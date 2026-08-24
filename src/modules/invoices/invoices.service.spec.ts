import { InvoicesService } from './invoices.service';
import { InvoiceSource, InvoiceStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

describe('InvoicesService.getContributorSummary', () => {
  const eventId = 'event-1';

  function makePrismaMock() {
    const invoices = [
      {
        id: 'inv-pledged',
        contributorName: 'Alice',
        contributorPhone: '+254700000001',
        amountRequested: '100',
        amountPaid: '0',
        status: InvoiceStatus.PENDING,
        source: InvoiceSource.PUBLIC_PLEDGE,
        expiresAt: new Date(),
      },
      {
        id: 'inv-partial',
        contributorName: 'Bob',
        contributorPhone: '+254700000002',
        amountRequested: '200',
        amountPaid: '50',
        status: InvoiceStatus.PARTIALLY_PAID,
        source: InvoiceSource.PUBLIC_PLEDGE,
        expiresAt: new Date(),
      },
      {
        id: 'inv-paid',
        contributorName: 'Carol',
        contributorPhone: '+254700000003',
        amountRequested: '75',
        amountPaid: '75',
        status: InvoiceStatus.PAID,
        source: InvoiceSource.ORGANIZER,
        expiresAt: new Date(),
      },
      {
        id: 'inv-expired',
        contributorName: 'Dan',
        contributorPhone: '+254700000004',
        amountRequested: '30',
        amountPaid: '0',
        status: InvoiceStatus.EXPIRED,
        source: InvoiceSource.PUBLIC_PLEDGE,
        expiresAt: new Date(),
      },
    ];

    const prisma = {
      event: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ title: 'Test Wedding' }),
      },
      invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    } as unknown as PrismaService;

    return prisma;
  }

  const audit = { record: jest.fn() } as unknown as AuditService;

  it('buckets invoices by status and computes totals', async () => {
    const prisma = makePrismaMock();
    const service = new InvoicesService(prisma, audit);

    const result = await service.getContributorSummary(eventId, {
      includePhone: true,
    });

    expect(result.buckets.pledged).toHaveLength(1);
    expect(result.buckets.pledged[0].contributorName).toBe('Alice');
    expect(result.buckets.pledged[0].source).toBe(InvoiceSource.PUBLIC_PLEDGE);
    expect(result.buckets.fullyPaid[0].source).toBe(InvoiceSource.ORGANIZER);
    expect(result.buckets.partiallyPaid).toHaveLength(1);
    expect(result.buckets.partiallyPaid[0].remaining).toBe(150);
    expect(result.buckets.fullyPaid).toHaveLength(1);
    expect(result.buckets.expired).toHaveLength(1);

    expect(result.totals.pledged).toBe(100 + 200 + 75 + 30);
    expect(result.totals.received).toBe(0 + 50 + 75 + 0);
  });

  it('includes contributorPhone when includePhone is true', async () => {
    const prisma = makePrismaMock();
    const service = new InvoicesService(prisma, audit);

    const result = await service.getContributorSummary(eventId, {
      includePhone: true,
    });

    expect(result.buckets.pledged[0].contributorPhone).toBe('+254700000001');
  });

  it('omits contributorPhone when includePhone is false', async () => {
    const prisma = makePrismaMock();
    const service = new InvoicesService(prisma, audit);

    const result = await service.getContributorSummary(eventId, {
      includePhone: false,
    });

    expect(result.buckets.pledged[0].contributorPhone).toBeUndefined();
    expect(result.buckets.partiallyPaid[0].contributorPhone).toBeUndefined();
  });

  it('includes each contributor bucket in the formatted text summary', async () => {
    const prisma = makePrismaMock();
    const service = new InvoicesService(prisma, audit);

    const result = await service.getContributorSummary(eventId, {
      includePhone: false,
    });

    expect(result.text).toContain('Test Wedding');
    expect(result.text).toContain('Alice');
    expect(result.text).toContain('Bob');
    expect(result.text).toContain('Carol');
    expect(result.text).not.toContain('+254700000001');
  });
});
