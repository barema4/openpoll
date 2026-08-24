import { BadRequestException } from '@nestjs/common';
import { BudgetCategoriesService } from './budget-categories.service';
import { TransactionStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

describe('BudgetCategoriesService.allocate', () => {
  const eventId = 'event-1';
  const budgetCategoryId = 'category-1';
  const transactionId = 'tx-1';

  function makePrismaMock(opts: {
    transactionStatus?: TransactionStatus;
    transactionEventId?: string;
    amountSettled?: number;
    alreadyAllocated?: number | null;
  }) {
    const tx = {
      budgetCategory: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: budgetCategoryId, eventId }),
        update: jest
          .fn()
          .mockResolvedValue({ id: budgetCategoryId, allocatedFunds: 0 }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: transactionId,
          eventId: opts.transactionEventId ?? eventId,
          status: opts.transactionStatus ?? TransactionStatus.SUCCESS,
          amountSettled: opts.amountSettled ?? 1000,
        }),
      },
      allocation: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: opts.alreadyAllocated ?? null },
        }),
        create: jest.fn().mockResolvedValue({ id: 'alloc-1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    return { prisma, tx };
  }

  const audit = { record: jest.fn() } as unknown as AuditService;

  it('creates an allocation and increments allocatedFunds when within the transaction balance', async () => {
    const { prisma, tx } = makePrismaMock({
      amountSettled: 1000,
      alreadyAllocated: null,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await service.allocate('user-1', budgetCategoryId, {
      transactionId,
      amount: 400,
    });

    expect(tx.allocation.create).toHaveBeenCalledWith({
      data: { transactionId, budgetCategoryId, amount: 400 },
    });
    expect(tx.budgetCategory.update).toHaveBeenCalledWith({
      where: { id: budgetCategoryId },
      data: { allocatedFunds: { increment: 400 } },
    });
  });

  it('rejects an allocation that exceeds the remaining unallocated balance', async () => {
    const { prisma } = makePrismaMock({
      amountSettled: 1000,
      alreadyAllocated: 700,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, {
        transactionId,
        amount: 400,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects allocating a transaction that has not settled (status != SUCCESS)', async () => {
    const { prisma } = makePrismaMock({
      transactionStatus: TransactionStatus.PENDING,
    });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, {
        transactionId,
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects allocating a transaction from a different event', async () => {
    const { prisma } = makePrismaMock({ transactionEventId: 'other-event' });
    const service = new BudgetCategoriesService(prisma, audit);

    await expect(
      service.allocate('user-1', budgetCategoryId, {
        transactionId,
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
