import { EventsService } from './events.service';
import { TransactionStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { OrganizationsService } from '../organizations/organizations.service';

const audit = { record: jest.fn() } as unknown as AuditService;
const payouts = {} as unknown as PayoutsService;

describe('EventsService.create', () => {
  it('auto-generates a permanent, open-amount default link and attaches its token', async () => {
    const eventCreate = jest
      .fn()
      .mockResolvedValue({ id: 'event-1', title: 'Fundraiser' });
    const prisma = {
      event: { create: eventCreate },
    } as unknown as PrismaService;
    const invoiceCreate = jest
      .fn()
      .mockResolvedValue({ id: 'inv-1', secureToken: 'tok-abc123' });
    const invoices = { create: invoiceCreate } as unknown as InvoicesService;
    const organizations = {} as unknown as OrganizationsService;
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    const result = await service.create('user-1', {
      organizationId: 'org-1',
      title: 'Fundraiser',
    });

    expect(invoiceCreate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ eventId: 'event-1', isPermanent: true }),
    );
    expect(result.defaultLinkToken).toBe('tok-abc123');
  });
});

describe('EventsService.createQuick', () => {
  it('reuses the caller personal org and creates a permanent event under it', async () => {
    const eventCreate = jest
      .fn()
      .mockResolvedValue({ id: 'event-1', title: 'Quick Fund' });
    const prisma = {
      event: { create: eventCreate },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Jane Doe' }),
      },
    } as unknown as PrismaService;
    const invoices = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', secureToken: 'tok-xyz' }),
    } as unknown as InvoicesService;
    const getOrCreatePersonalOrg = jest
      .fn()
      .mockResolvedValue({ id: 'personal-org-1' });
    const organizations = {
      getOrCreatePersonalOrg,
    } as unknown as OrganizationsService;
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    await service.createQuick('user-1', { title: 'Quick Fund' });

    expect(getOrCreatePersonalOrg).toHaveBeenCalledWith(
      'user-1',
      'Jane Doe',
      undefined,
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'personal-org-1',
          isPermanent: true,
        }),
      }),
    );
  });
});

describe('EventsService.findOne', () => {
  const payouts = {} as unknown as PayoutsService;
  const invoices = {} as unknown as InvoicesService;
  const organizations = {} as unknown as OrganizationsService;

  function makePrisma(opts: {
    totalReceived?: number | null;
    totalAllocated?: number | null;
  }) {
    const transactionAggregate = jest.fn().mockResolvedValue({
      _sum: { amountSettled: opts.totalReceived ?? null },
    });
    const budgetCategoryAggregate = jest.fn().mockResolvedValue({
      _sum: { allocatedFunds: opts.totalAllocated ?? null },
    });
    const prisma = {
      event: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'event-1', title: 'Fundraiser' }),
      },
      transaction: { aggregate: transactionAggregate },
      budgetCategory: { aggregate: budgetCategoryAggregate },
    } as unknown as PrismaService;
    return { prisma, transactionAggregate, budgetCategoryAggregate };
  }

  it('includes totalReceived, summed from SUCCESS transactions only', async () => {
    const { prisma, transactionAggregate } = makePrisma({
      totalReceived: 1500,
    });
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    const result = await service.findOne('event-1');

    expect(transactionAggregate).toHaveBeenCalledWith({
      where: { eventId: 'event-1', status: TransactionStatus.SUCCESS },
      _sum: { amountSettled: true },
    });
    expect(result.totalReceived).toBe(1500);
  });

  it('includes totalAllocated, summed across every budget category', async () => {
    const { prisma, budgetCategoryAggregate } = makePrisma({
      totalAllocated: 900,
    });
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    const result = await service.findOne('event-1');

    expect(budgetCategoryAggregate).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      _sum: { allocatedFunds: true },
    });
    expect(result.totalAllocated).toBe(900);
  });

  it('defaults totalReceived and totalAllocated to 0 when there is nothing yet', async () => {
    const { prisma } = makePrisma({
      totalReceived: null,
      totalAllocated: null,
    });
    const service = new EventsService(
      prisma,
      audit,
      payouts,
      invoices,
      organizations,
    );

    const result = await service.findOne('event-1');

    expect(result.totalReceived).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });
});
