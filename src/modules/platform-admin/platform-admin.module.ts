import { Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PublicPlatformStaffInvitationsController } from './public-platform-staff-invitations.controller';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [
    PlatformAdminController,
    PublicPlatformStaffInvitationsController,
  ],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
