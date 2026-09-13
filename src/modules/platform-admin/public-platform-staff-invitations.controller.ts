import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAdminService } from './platform-admin.service';

// Unauthenticated — lets the registration page preview a staff invite
// (email) before the invited person creates an account.
@ApiTags('public')
@Controller('public/platform-staff-invitations')
export class PublicPlatformStaffInvitationsController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.platformAdminService.getInvitationPreview(token);
  }
}
