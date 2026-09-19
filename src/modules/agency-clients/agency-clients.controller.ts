import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AgencyClientsService } from './agency-clients.service';
import { CreateClientOrgDto } from './dto/create-client-org.dto';
import { GrantClientAccessDto } from './dto/grant-client-access.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// :organizationId here is always the AGENCY's org — OrgRolesGuard resolves
// role checks off that param name, so every @Roles() below is checked
// against the caller's access to the agency, never the client directly.
@ApiTags('agency-clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('organizations/:organizationId/clients')
export class AgencyClientsController {
  constructor(private readonly agencyClients: AgencyClientsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Post()
  createClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateClientOrgDto,
  ) {
    return this.agencyClients.createClient(organizationId, user.id, dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listClients(@Param('organizationId') organizationId: string) {
    return this.agencyClients.listClients(organizationId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Get(':clientOrganizationId/access')
  listAccess(
    @Param('organizationId') organizationId: string,
    @Param('clientOrganizationId') clientOrganizationId: string,
  ) {
    return this.agencyClients.listAccessForClient(
      organizationId,
      clientOrganizationId,
    );
  }

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Post(':clientOrganizationId/access')
  grantAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('clientOrganizationId') clientOrganizationId: string,
    @Body() dto: GrantClientAccessDto,
  ) {
    return this.agencyClients.grantAccess(
      organizationId,
      clientOrganizationId,
      user.id,
      dto,
    );
  }

  @Roles(OrgRole.MAIN_ORGANIZER)
  @Delete(':clientOrganizationId/access/:userId')
  revokeAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('clientOrganizationId') clientOrganizationId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.agencyClients.revokeAccess(
      organizationId,
      clientOrganizationId,
      targetUserId,
      user.id,
    );
  }
}
