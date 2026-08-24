import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TransactionStatus } from '../../../generated/prisma/enums';
import type { CreateBudgetCategoryDto } from './dto/create-budget-category.dto';
import type { AllocateTransactionDto } from './dto/allocate-transaction.dto';

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

  findOne(budgetCategoryId: string) {
    return this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
    });
  }

  listForEvent(eventId: string) {
    return this.prisma.budgetCategory.findMany({ where: { eventId } });
  }

  async allocate(
    userId: string,
    budgetCategoryId: string,
    dto: AllocateTransactionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.budgetCategory.findUniqueOrThrow({
        where: { id: budgetCategoryId },
      });

      const transaction = await tx.transaction.findUnique({
        where: { id: dto.transactionId },
      });
      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }
      if (transaction.status !== TransactionStatus.SUCCESS) {
        throw new BadRequestException(
          'Only settled (SUCCESS) transactions can be allocated',
        );
      }
      if (transaction.eventId !== category.eventId) {
        throw new BadRequestException(
          'Transaction and budget category must belong to the same event',
        );
      }

      const existingAllocations = await tx.allocation.aggregate({
        where: { transactionId: dto.transactionId },
        _sum: { amount: true },
      });
      const alreadyAllocated = existingAllocations._sum.amount ?? 0;
      const remaining =
        Number(transaction.amountSettled) - Number(alreadyAllocated);
      if (dto.amount > remaining) {
        throw new BadRequestException(
          `Allocation amount exceeds remaining unallocated transaction balance (${remaining})`,
        );
      }

      const allocation = await tx.allocation.create({
        data: {
          transactionId: dto.transactionId,
          budgetCategoryId,
          amount: dto.amount,
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
          payloadSnapshot: {
            budgetCategoryId,
            transactionId: dto.transactionId,
            amount: dto.amount,
          },
        },
      });

      return { allocation, budgetCategory: updatedCategory };
    });
  }
}
