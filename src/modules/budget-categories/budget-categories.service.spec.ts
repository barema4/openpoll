import { BadRequestException } from '@nestjs/common';
import { BudgetCategoriesService } from './budget-categories.service';
import {
  BudgetApprovalStatus,
  PaymentRail,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

describe('BudgetCategoriesService.allocate', () => {
  const eventId = 'event-1';
  const budgetCategoryId = 'category-1';
  const audit = { record: jest.fn() } as unknown as AuditService;

  function makePrismaMock(opts: {
    totalReceived?: number | null;
    totalAllocated?: number | null;
  }) {
    const tx = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: budgetCategoryId, eventId }),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { allocatedFunds: opts.totalAllocated ?? null },
        }),
        update: jest
          .fn()
          .mockResolvedValue({ id: budgetCategoryId, allocatedFunds: 0 }),
      },
      budgetApproval: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      transaction: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amountSettled: opts.totalReceived ?? null },
        }),
      },
      allocation: { create: jest.fn().mockResolvedValue({ id: 'alloc-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    return { prisma, tx };
  }

  it('allocates from the event pool when within the remaining unallocated balance', async () => {
    const { prisma, tx } = makePrismaMock({
      totalReceived: 1000,
      totalAllocated: 200,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await service.allocate('user-1', budgetCategoryId, { amount: 400 });

    expect(tx.allocation.create).toHaveBeenCalledWith({
      data: {
        eventId,
        budgetCategoryId,
        amount: 400,
        allocatedByUserId: 'user-1',
      },
    });
    expect(tx.budgetCategory.update).toHaveBeenCalledWith({
      where: { id: budgetCategoryId },
      data: { allocatedFunds: { increment: 400 } },
    });
  });

  it('excludes manual (off-app) contributions from the allocatable pool — there is no real money behind them to later disburse', async () => {
    const { prisma, tx } = makePrismaMock({
      totalReceived: 500,
      totalAllocated: 0,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await service.allocate('user-1', budgetCategoryId, { amount: 500 });

    expect(tx.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentRail: { not: PaymentRail.MANUAL },
        }),
      }),
    );
  });

  it('rejects an allocation that exceeds the event-wide remaining balance', async () => {
    const { prisma } = makePrismaMock({
      totalReceived: 1000,
      totalAllocated: 700,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, { amount: 400 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('computes remaining across every category in the event, not just this one — funds already given to category A block category B', async () => {
    // totalAllocated already reflects everything allocated event-wide
    // (e.g. 900 given to a different category), even though this category
    // itself has never been allocated anything.
    const { prisma } = makePrismaMock({
      totalReceived: 1000,
      totalAllocated: 900,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, { amount: 200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats no prior transactions/allocations as a zero pool, not null', async () => {
    const { prisma } = makePrismaMock({
      totalReceived: null,
      totalAllocated: null,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, { amount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BudgetCategoriesService.update', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  it("updates a category's name and/or estimated cost", async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'category-1',
      name: 'Venue',
      estimatedCost: 50000,
    });
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ eventId: 'event-1' });
    const prisma = {
      budgetCategory: { update, findUniqueOrThrow },
      budgetApproval: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    const result = await service.update('category-1', {
      name: 'Venue',
      estimatedCost: 50000,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { name: 'Venue', estimatedCost: 50000 },
    });
    expect(result).toEqual({
      id: 'category-1',
      name: 'Venue',
      estimatedCost: 50000,
    });
  });
});

describe('BudgetCategoriesService.listForEvent', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  function makeService(findMany: jest.Mock, count: jest.Mock) {
    const prisma = {
      budgetCategory: { findMany, count },
    } as unknown as PrismaService;
    return new BudgetCategoriesService(prisma, audit);
  }

  it('paginates with the default page/pageSize, ordered oldest-first', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'cat-1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = makeService(findMany, count);

    const result = await service.listForEvent({ eventId: 'event-1' });

    expect(findMany).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      orderBy: { createdAt: 'asc' },
      skip: 0,
      take: 10,
    });
    expect(result).toEqual({
      data: [{ id: 'cat-1' }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });

  it('computes skip from page and pageSize', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.listForEvent({ eventId: 'event-1', page: 3, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });
});

describe('BudgetCategoriesService.remove', () => {
  it('deletes the category and audit-logs its allocated funds at the time of deletion', async () => {
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const deletedCategory = {
      id: 'category-1',
      eventId: 'event-1',
      name: 'Venue',
      allocatedFunds: { toString: () => '400' },
    };
    const deleteFn = jest.fn().mockResolvedValue(deletedCategory);
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ eventId: 'event-1' });
    const prisma = {
      budgetCategory: { delete: deleteFn, findUniqueOrThrow },
      budgetApproval: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    const result = await service.remove('user-1', 'category-1');

    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'category-1' } });
    expect(recordAudit).toHaveBeenCalledWith({
      userId: 'user-1',
      eventId: 'event-1',
      action: 'BUDGET_CATEGORY_DELETED',
      payload: {
        budgetCategoryId: 'category-1',
        name: 'Venue',
        allocatedFunds: '400',
      },
    });
    expect(result).toBe(deletedCategory);
  });
});

describe('BudgetCategoriesService — locked while pending/approved/funded', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  function makePrisma(status: BudgetApprovalStatus) {
    return {
      budgetApproval: {
        findUnique: jest.fn().mockResolvedValue({ status }),
      },
      budgetCategory: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ eventId: 'event-1' }),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as unknown as PrismaService;
  }

  it.each([
    BudgetApprovalStatus.SUBMITTED,
    BudgetApprovalStatus.APPROVED,
    BudgetApprovalStatus.FUNDED,
  ])('rejects create() while the budget is %s', async (status) => {
    const prisma = makePrisma(status);
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.create('user-1', { eventId: 'event-1', name: 'Venue' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects update() while the budget is SUBMITTED', async () => {
    const prisma = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.update('category-1', { name: 'Venue' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects remove() while the budget is SUBMITTED', async () => {
    const prisma = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(service.remove('user-1', 'category-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects allocate() while the budget is SUBMITTED', async () => {
    const tx = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'category-1', eventId: 'event-1' }),
      },
      budgetApproval: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: BudgetApprovalStatus.SUBMITTED }),
      },
    };
    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', 'category-1', { amount: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([BudgetApprovalStatus.DRAFT, BudgetApprovalStatus.DECLINED])(
    'allows create() while the budget is %s',
    async (status) => {
      const prisma = makePrisma(status);
      (prisma.budgetCategory.create as jest.Mock).mockResolvedValue({
        id: 'category-1',
      });
      const service = new BudgetCategoriesService(prisma, audit);

      await expect(
        service.create('user-1', { eventId: 'event-1', name: 'Venue' }),
      ).resolves.toEqual({ id: 'category-1' });
    },
  );

  it('allows create() when no BudgetApproval row exists yet (never submitted)', async () => {
    const prisma = {
      budgetApproval: { findUnique: jest.fn().mockResolvedValue(null) },
      budgetCategory: {
        create: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.create('user-1', { eventId: 'event-1', name: 'Venue' }),
    ).resolves.toEqual({ id: 'category-1' });
  });
});

describe('BudgetCategoriesService.assignVendor', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  it('assigns a vendor that belongs to the same organization as the event', async () => {
    const findUniqueOrThrowCategory = jest
      .fn()
      .mockResolvedValue({ event: { organizationId: 'org-1' } });
    const findUniqueVendor = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1' });
    const update = jest
      .fn()
      .mockResolvedValue({ id: 'category-1', vendorId: 'vendor-1' });
    const prisma = {
      budgetCategory: { findUniqueOrThrow: findUniqueOrThrowCategory, update },
      vendor: { findUnique: findUniqueVendor },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    const result = await service.assignVendor('category-1', {
      vendorId: 'vendor-1',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { vendorId: 'vendor-1' },
    });
    expect(result).toEqual({ id: 'category-1', vendorId: 'vendor-1' });
  });

  it('rejects a vendor belonging to a different organization with no agency relationship', async () => {
    const prisma = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ event: { organizationId: 'org-1' } }),
      },
      vendor: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-2' }),
      },
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.assignVendor('category-1', { vendorId: 'vendor-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows a vendor owned by the agency managing this event's organization", async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 'category-1', vendorId: 'vendor-1' });
    const prisma = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ event: { organizationId: 'client-org-1' } }),
        update,
      },
      vendor: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organizationId: 'agency-org-1' }),
      },
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    const result = await service.assignVendor('category-1', {
      vendorId: 'vendor-1',
    });

    expect(result).toEqual({ id: 'category-1', vendorId: 'vendor-1' });
  });

  it("rejects a vendor owned by a different agency than the one managing this event's organization", async () => {
    const prisma = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ event: { organizationId: 'client-org-1' } }),
      },
      vendor: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organizationId: 'some-other-org' }),
      },
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.assignVendor('category-1', { vendorId: 'vendor-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unassigns the vendor when vendorId is null, without checking any vendor', async () => {
    const findUniqueVendor = jest.fn();
    const update = jest
      .fn()
      .mockResolvedValue({ id: 'category-1', vendorId: null });
    const prisma = {
      budgetCategory: { findUniqueOrThrow: jest.fn(), update },
      vendor: { findUnique: findUniqueVendor },
    } as unknown as PrismaService;
    const service = new BudgetCategoriesService(prisma, audit);

    await service.assignVendor('category-1', { vendorId: null });

    expect(findUniqueVendor).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { vendorId: null },
    });
  });
});
