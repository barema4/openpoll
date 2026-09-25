import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from '../organizations/organizations.service';
import { ListOrganizationsQueryDto } from '../organizations/dto/list-organizations-query.dto';
import { SetArchivedDto } from '../organizations/dto/set-archived.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// Platform-wide organization lookup for staff support — separate from
// OrganizationsController, which only ever shows the caller's own orgs.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER, PlatformRole.STAFF)
@Controller('admin/organizations')
export class AdminOrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  list(@Query() query: ListOrganizationsQueryDto) {
    return this.organizationsService.listAllForAdmin(query);
  }

  @Patch(':organizationId/archive')
  setArchived(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: SetArchivedDto,
  ) {
    return this.organizationsService.setArchived(
      user.id,
      organizationId,
      dto.archived,
    );
  }
}
