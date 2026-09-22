import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PublicOrganizationInvitationsController } from './public-organization-invitations.controller';
import { PublicSupportedCountriesController } from './public-supported-countries.controller';
import { PayoutsModule } from '../payouts/payouts.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PayoutsModule, EmailModule],
  controllers: [
    OrganizationsController,
    PublicOrganizationInvitationsController,
    PublicSupportedCountriesController,
  ],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
