import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('organizations/:organizationId/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  getStatus(@Param('organizationId') organizationId: string) {
    return this.billing.getStatus(organizationId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Post('checkout-session')
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.billing.createCheckoutSession(organizationId, user.id);
  }

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Post('portal-session')
  createPortalSession(@Param('organizationId') organizationId: string) {
    return this.billing.createPortalSession(organizationId);
  }
}
