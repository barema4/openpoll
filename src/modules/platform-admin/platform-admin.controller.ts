import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAdminService } from './platform-admin.service';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { SetAgencyPlanDto } from './dto/set-agency-plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('platform-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER)
@Controller('admin/staff')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  listStaff() {
    return this.platformAdminService.listStaff();
  }

  @Post('invite')
  inviteStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteStaffDto,
  ) {
    return this.platformAdminService.inviteStaff(user.id, dto);
  }

  @Delete(':userId')
  revokeStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.platformAdminService.revokeStaff(user.id, userId);
  }

  @Patch('organizations/:organizationId/agency-plan')
  setAgencyPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: SetAgencyPlanDto,
  ) {
    return this.platformAdminService.setAgencyPlan(
      user.id,
      organizationId,
      dto.hasAgencyPlan,
    );
  }
}
