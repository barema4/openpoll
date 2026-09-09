import { BadRequestException } from '@nestjs/common';
import { BudgetCategoriesService } from './budget-categories.service';
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
    const prisma = { budgetCategory: { update } } as unknown as PrismaService;
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
