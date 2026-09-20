import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BudgetCategoriesService } from '../budget-categories/budget-categories.service';
import {
  resolveOwnerOrganizationIds,
  isOwnerOrganization,
} from '../../common/agency-link.util';
import type { CreateBudgetTemplateDto } from './dto/create-budget-template.dto';
import type { SaveTemplateFromEventDto } from './dto/save-template-from-event.dto';
import type { ApplyTemplateDto } from './dto/apply-template.dto';

@Injectable()
export class BudgetTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetCategories: BudgetCategoriesService,
  ) {}

  async create(dto: CreateBudgetTemplateDto) {
    for (const item of dto.items) {
      const hasPercentage = item.percentage !== undefined;
      const hasFixedAmount = item.fixedAmount !== undefined;
      if (hasPercentage === hasFixedAmount) {
        throw new BadRequestException(
          `"${item.name}" must set exactly one of percentage or fixedAmount`,
        );
      }
    }

    return this.prisma.budgetTemplate.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        items: {
          create: dto.items.map((item, index) => ({
            name: item.name,
            percentage: item.percentage,
            fixedAmount: item.fixedAmount,
            sortOrder: index,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // Snapshots an event's current categories as a reusable template —
  // percentage-of-goal when the event has a targetGoal (matching how the
  // existing hardcoded wedding template already computes estimatedCost),
  // otherwise a fixed amount.
  async createFromEvent(dto: SaveTemplateFromEventDto) {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: dto.eventId },
      select: {
        organizationId: true,
        targetGoal: true,
        budgetCategories: { select: { name: true, estimatedCost: true } },
      },
    });

    if (
      !event.organizationId ||
      !(await isOwnerOrganization(
        this.prisma,
        event.organizationId,
        dto.organizationId,
      ))
    ) {
      throw new BadRequestException(
        "That event doesn't belong to this organization",
      );
    }
    if (event.budgetCategories.length === 0) {
      throw new BadRequestException(
        'This event has no budget categories to save as a template',
      );
    }

    const goal = Number(event.targetGoal ?? 0);
    const items = event.budgetCategories.map((category) => {
      const estimatedCost = Number(category.estimatedCost);
      return goal > 0
        ? { name: category.name, percentage: estimatedCost / goal }
        : { name: category.name, fixedAmount: estimatedCost };
    });

    return this.create({
      organizationId: dto.organizationId,
      name: dto.name,
      items,
    });
  }

  async listForOrganization(organizationId: string) {
    const organizationIds = await resolveOwnerOrganizationIds(
      this.prisma,
      organizationId,
    );

    return this.prisma.budgetTemplate.findMany({
      where: { organizationId: { in: organizationIds } },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(budgetTemplateId: string) {
    return this.prisma.budgetTemplate.delete({
      where: { id: budgetTemplateId },
    });
  }

  // Reuses BudgetCategoriesService.create() per item — inherits its
  // assertBudgetEditable lock for free, so applying a template is blocked
  // the same way manually adding a category already is once the budget is
  // submitted/approved/funded.
  async apply(userId: string, budgetTemplateId: string, dto: ApplyTemplateDto) {
    const template = await this.prisma.budgetTemplate.findUniqueOrThrow({
      where: { id: budgetTemplateId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: dto.eventId },
      select: { organizationId: true, targetGoal: true },
    });

    if (
      !event.organizationId ||
      !(await isOwnerOrganization(
        this.prisma,
        event.organizationId,
        template.organizationId,
      ))
    ) {
      throw new BadRequestException(
        "That template isn't available to this event's organization",
      );
    }

    const goal = Number(event.targetGoal ?? 0);
    const created = [];
    for (const item of template.items) {
      const estimatedCost =
        item.percentage !== null
          ? Math.round(goal * Number(item.percentage))
          : Number(item.fixedAmount);
      created.push(
        await this.budgetCategories.create(userId, {
          eventId: dto.eventId,
          name: item.name,
          estimatedCost,
        }),
      );
    }
    return created;
  }
}
