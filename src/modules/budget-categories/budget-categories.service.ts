import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TransactionStatus } from '../../../generated/prisma/enums';
import type { CreateBudgetCategoryDto } from './dto/create-budget-category.dto';
import type { UpdateBudgetCategoryDto } from './dto/update-budget-category.dto';
import type { AllocateBudgetDto } from './dto/allocate-budget.dto';

@Injectable()
export class BudgetCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(userId: string, dto: CreateBudgetCategoryDto) {
    return this.prisma.budgetCategory.create({
      data: {
        eventId: dto.eventId,
        name: dto.name,
        estimatedCost: dto.estimatedCost ?? 0,
      },
    });
  }

  update(budgetCategoryId: string, dto: UpdateBudgetCategoryDto) {
    return this.prisma.budgetCategory.update({
      where: { id: budgetCategoryId },
      data: { name: dto.name, estimatedCost: dto.estimatedCost },
    });
  }

  findOne(budgetCategoryId: string) {
    return this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
    });
  }

  listForEvent(eventId: string) {
    return this.prisma.budgetCategory.findMany({ where: { eventId } });
  }

  // Pool-based: an event's collected money is one fungible pool, and
  // allocating just moves part of the *event's remaining unallocated
  // balance* into a category — not a specific payment. Remaining is computed
  // fresh from the whole event (all SUCCESS transactions minus everything
  // already allocated across every category), so allocating to one category
  // is correctly blocked by what's already been allocated to others.
  async allocate(
    userId: string,
    budgetCategoryId: string,
    dto: AllocateBudgetDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.budgetCategory.findUniqueOrThrow({
        where: { id: budgetCategoryId },
      });

      const [receivedAgg, allocatedAgg] = await Promise.all([
        tx.transaction.aggregate({
          where: {
            eventId: category.eventId,
            status: TransactionStatus.SUCCESS,
          },
          _sum: { amountSettled: true },
        }),
        tx.budgetCategory.aggregate({
          where: { eventId: category.eventId },
          _sum: { allocatedFunds: true },
        }),
      ]);
      const totalReceived = Number(receivedAgg._sum.amountSettled ?? 0);
      const totalAllocated = Number(allocatedAgg._sum.allocatedFunds ?? 0);
      const remaining = totalReceived - totalAllocated;

      if (dto.amount > remaining) {
        throw new BadRequestException(
          `Allocation amount exceeds the event's remaining unallocated balance (${remaining})`,
        );
      }

      const allocation = await tx.allocation.create({
        data: {
          eventId: category.eventId,
          budgetCategoryId,
          amount: dto.amount,
          allocatedByUserId: userId,
        },
      });

      const updatedCategory = await tx.budgetCategory.update({
        where: { id: budgetCategoryId },
        data: { allocatedFunds: { increment: dto.amount } },
      });

      await tx.auditLog.create({
        data: {
          userId,
          eventId: category.eventId,
          action: 'BUDGET_ALLOCATION_CREATED',
          payloadSnapshot: { budgetCategoryId, amount: dto.amount },
        },
      });

      return { allocation, budgetCategory: updatedCategory };
    });
  }
}
