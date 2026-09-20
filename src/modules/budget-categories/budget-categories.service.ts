import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  BudgetApprovalStatus,
  PaymentRail,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { CreateBudgetCategoryDto } from './dto/create-budget-category.dto';
import type { UpdateBudgetCategoryDto } from './dto/update-budget-category.dto';
import type { AllocateBudgetDto } from './dto/allocate-budget.dto';
import type { AssignVendorDto } from './dto/assign-vendor.dto';
import type { ListBudgetCategoriesQueryDto } from './dto/list-budget-categories-query.dto';
import { paginate } from '../../common/pagination.util';
import { isOwnerOrganization } from '../../common/agency-link.util';

const EDITABLE_STATUSES: BudgetApprovalStatus[] = [
  BudgetApprovalStatus.DRAFT,
  BudgetApprovalStatus.DECLINED,
];

@Injectable()
export class BudgetCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // No BudgetApproval row yet means the budget has never been submitted
  // (still effectively DRAFT) — only a row with a non-editable status
  // actually blocks the mutation.
  private async assertBudgetEditable(eventId: string) {
    const approval = await this.prisma.budgetApproval.findUnique({
      where: { eventId },
    });
    if (approval && !EDITABLE_STATUSES.includes(approval.status)) {
      throw new BadRequestException(
        "This event's budget is pending approval or already approved/funded — decline it first to make changes",
      );
    }
  }

  async create(userId: string, dto: CreateBudgetCategoryDto) {
    await this.assertBudgetEditable(dto.eventId);
    return this.prisma.budgetCategory.create({
      data: {
        eventId: dto.eventId,
        name: dto.name,
        estimatedCost: dto.estimatedCost ?? 0,
      },
    });
  }

  async update(budgetCategoryId: string, dto: UpdateBudgetCategoryDto) {
    const category = await this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
      select: { eventId: true },
    });
    await this.assertBudgetEditable(category.eventId);
    return this.prisma.budgetCategory.update({
      where: { id: budgetCategoryId },
      data: { name: dto.name, estimatedCost: dto.estimatedCost },
    });
  }

  // Deliberately NOT gated by assertBudgetEditable — choosing which vendor
  // gets paid doesn't change the approved numbers, and this is meant to
  // happen precisely once the budget is FUNDED (i.e. well past DRAFT/
  // DECLINED). DisbursementsService.pay() is what actually enforces FUNDED
  // before any money moves.
  async assignVendor(budgetCategoryId: string, dto: AssignVendorDto) {
    if (dto.vendorId) {
      const category = await this.prisma.budgetCategory.findUniqueOrThrow({
        where: { id: budgetCategoryId },
        select: { event: { select: { organizationId: true } } },
      });
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: dto.vendorId },
        select: { organizationId: true },
      });

      const eventOrganizationId = category.event.organizationId;
      // Also allows a vendor owned by whichever agency manages this event's
      // org — the same cross-client roster listForOrganization() exposes.
      const belongs =
        !!vendor &&
        !!eventOrganizationId &&
        (await isOwnerOrganization(
          this.prisma,
          eventOrganizationId,
          vendor.organizationId,
        ));

      if (!belongs) {
        throw new BadRequestException(
          "That vendor doesn't belong to this event's organization",
        );
      }
    }

    return this.prisma.budgetCategory.update({
      where: { id: budgetCategoryId },
      data: { vendorId: dto.vendorId },
    });
  }

  findOne(budgetCategoryId: string) {
    return this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
    });
  }

  async listForEvent(query: ListBudgetCategoriesQueryDto) {
    const { eventId, page = 1, pageSize = 10 } = query;
    const where = { eventId };
    const [data, total] = await Promise.all([
      this.prisma.budgetCategory.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.budgetCategory.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }

  // Cascades to the category's Allocation rows (schema-level onDelete:
  // Cascade), which returns whatever was allocated to it back to the
  // event's unallocated pool automatically — remaining is always computed
  // fresh from BudgetCategory.allocatedFunds across the event, so there's
  // nothing else to reconcile. Disbursements referencing this category are
  // preserved with budgetCategoryId set to null (onDelete: SetNull).
  async remove(userId: string, budgetCategoryId: string) {
    const existing = await this.prisma.budgetCategory.findUniqueOrThrow({
      where: { id: budgetCategoryId },
      select: { eventId: true },
    });
    await this.assertBudgetEditable(existing.eventId);

    const category = await this.prisma.budgetCategory.delete({
      where: { id: budgetCategoryId },
    });

    await this.audit.record({
      userId,
      eventId: category.eventId,
      action: 'BUDGET_CATEGORY_DELETED',
      payload: {
        budgetCategoryId,
        name: category.name,
        allocatedFunds: category.allocatedFunds.toString(),
      },
    });

    return category;
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

      const approval = await tx.budgetApproval.findUnique({
        where: { eventId: category.eventId },
      });
      if (approval && !EDITABLE_STATUSES.includes(approval.status)) {
        throw new BadRequestException(
          "This event's budget is pending approval or already approved/funded — decline it first to make changes",
        );
      }

      const [receivedAgg, allocatedAgg] = await Promise.all([
        // Excludes paymentRail: MANUAL — those entries record money received
        // outside the app (cash, a direct mobile money transfer) and were
        // never actually deposited into the platform's balance. A category
        // funded from one can be disbursed for real to a vendor once
        // approved (DisbursementsService.pay()), so only real, gateway-
        // settled money may ever be allocated — same exclusion
        // WithdrawalsService.getBalance() already applies for the same reason.
        tx.transaction.aggregate({
          where: {
            eventId: category.eventId,
            status: TransactionStatus.SUCCESS,
            paymentRail: { not: PaymentRail.MANUAL },
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
