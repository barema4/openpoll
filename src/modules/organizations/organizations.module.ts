import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PublicOrganizationInvitationsController } from './public-organization-invitations.controller';
import { PayoutsModule } from '../payouts/payouts.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PayoutsModule, EmailModule],
  controllers: [
    OrganizationsController,
    PublicOrganizationInvitationsController,
  ],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
