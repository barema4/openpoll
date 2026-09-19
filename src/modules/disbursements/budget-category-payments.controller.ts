import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DisbursementsService } from './disbursements.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// Separate controller (same 'budget-categories' route prefix as
// BudgetCategoriesController) so the "Pay" action lives with the rest of
// the disbursement concern rather than inside budget-categories.service.ts,
// which knows nothing about vendors or payout providers.
@ApiTags('disbursements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('budget-categories')
export class BudgetCategoryPaymentsController {
  constructor(private readonly disbursementsService: DisbursementsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post(':budgetCategoryId/pay')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('budgetCategoryId') budgetCategoryId: string,
  ) {
    return this.disbursementsService.pay(user.id, budgetCategoryId);
  }
}
