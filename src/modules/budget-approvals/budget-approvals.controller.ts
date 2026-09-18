import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BudgetApprovalsService } from './budget-approvals.service';
import { DecideBudgetDto } from './dto/decide-budget.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('budget-approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('events/:eventId/budget-approval')
export class BudgetApprovalsController {
  constructor(private readonly budgetApprovals: BudgetApprovalsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  getStatus(@Param('eventId') eventId: string) {
    return this.budgetApprovals.getStatus(eventId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post('submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
  ) {
    return this.budgetApprovals.submit(user.id, eventId);
  }

  // Finance-only — this is the separation-of-duties gate the whole feature
  // exists for, so unlike submit() this is deliberately not also open to
  // MAIN_ORGANIZER.
  @Roles(OrgRole.TREASURER)
  @Post('decide')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: DecideBudgetDto,
  ) {
    return this.budgetApprovals.decide(user.id, eventId, dto);
  }

  @Roles(OrgRole.TREASURER)
  @Post('fund')
  fund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
  ) {
    return this.budgetApprovals.fund(user.id, eventId);
  }
}
