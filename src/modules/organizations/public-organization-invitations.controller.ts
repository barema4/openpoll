import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';

// Unauthenticated — lets the registration page preview an invite (org name,
// role, email) before the invited person creates an account.
@ApiTags('public')
@Controller('public/organization-invitations')
export class PublicOrganizationInvitationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.organizationsService.getInvitationPreview(token);
  }
}
