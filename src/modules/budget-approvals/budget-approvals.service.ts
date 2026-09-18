import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { BudgetApprovalStatus } from '../../../generated/prisma/enums';
import type { DecideBudgetDto } from './dto/decide-budget.dto';

const EDITABLE_STATUSES: BudgetApprovalStatus[] = [
  BudgetApprovalStatus.DRAFT,
  BudgetApprovalStatus.DECLINED,
];

@Injectable()
export class BudgetApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Lazily creates the DRAFT row on first read — most events never submit a
  // budget for approval, so there's no reason to pre-create this row the
  // moment budgeting is turned on.
  async getStatus(eventId: string) {
    const existing = await this.prisma.budgetApproval.findUnique({
      where: { eventId },
    });
    if (existing) return existing;
    return this.prisma.budgetApproval.create({ data: { eventId } });
  }

  async submit(userId: string, eventId: string) {
    const approval = await this.getStatus(eventId);
    if (!EDITABLE_STATUSES.includes(approval.status)) {
      throw new BadRequestException('This budget has already been submitted');
    }

    const allocatedAgg = await this.prisma.budgetCategory.aggregate({
      where: { eventId },
      _sum: { allocatedFunds: true },
    });
    if (Number(allocatedAgg._sum.allocatedFunds ?? 0) <= 0) {
      throw new BadRequestException(
        'Allocate funds to at least one budget category before submitting',
      );
    }

    const updated = await this.prisma.budgetApproval.update({
      where: { eventId },
      data: {
        status: BudgetApprovalStatus.SUBMITTED,
        submittedByUserId: userId,
        submittedAt: new Date(),
        // Clear any previous decision so a resubmission doesn't carry a
        // stale decline reason forward.
        decidedByUserId: null,
        decidedAt: null,
        declineReason: null,
      },
    });

    await this.audit.record({
      userId,
      eventId,
      action: 'BUDGET_SUBMITTED',
      payload: { budgetApprovalId: updated.id },
    });
    return updated;
  }

  async decide(userId: string, eventId: string, dto: DecideBudgetDto) {
    const approval = await this.getStatus(eventId);
    if (approval.status !== BudgetApprovalStatus.SUBMITTED) {
      throw new BadRequestException('This budget is not awaiting a decision');
    }
    if (!dto.approve && !dto.reason) {
      throw new BadRequestException(
        'A reason is required when declining a budget',
      );
    }

    const updated = await this.prisma.budgetApproval.update({
      where: { eventId },
      data: {
        status: dto.approve
          ? BudgetApprovalStatus.APPROVED
          : BudgetApprovalStatus.DECLINED,
        decidedByUserId: userId,
        decidedAt: new Date(),
        declineReason: dto.approve ? null : dto.reason,
      },
    });

    await this.audit.record({
      userId,
      eventId,
      action: dto.approve ? 'BUDGET_APPROVED' : 'BUDGET_DECLINED',
      payload: { budgetApprovalId: updated.id, reason: dto.reason ?? null },
    });
    return updated;
  }

  // Funding is a release gate, not a money movement — the funds already sit
  // in the platform's pooled balance from collected transactions (the same
  // pool WithdrawalsService.getBalance and reconciliation already read from).
  // This just records that finance has signed off on releasing them for
  // vendor disbursement (see the disbursements module).
  async fund(userId: string, eventId: string) {
    const approval = await this.getStatus(eventId);
    if (approval.status !== BudgetApprovalStatus.APPROVED) {
      throw new BadRequestException('Only an approved budget can be funded');
    }

    const updated = await this.prisma.budgetApproval.update({
      where: { eventId },
      data: {
        status: BudgetApprovalStatus.FUNDED,
        fundedByUserId: userId,
        fundedAt: new Date(),
      },
    });

    await this.audit.record({
      userId,
      eventId,
      action: 'BUDGET_FUNDED',
      payload: { budgetApprovalId: updated.id },
    });
    return updated;
  }
}
