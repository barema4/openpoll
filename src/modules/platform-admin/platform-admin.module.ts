import { Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PublicPlatformStaffInvitationsController } from './public-platform-staff-invitations.controller';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminTransactionsController } from './admin-transactions.controller';
import { AdminDisputesController } from './admin-disputes.controller';
import { AdminPlatformPayoutsController } from './admin-platform-payouts.controller';
import { EmailModule } from '../../email/email.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PlatformPayoutsModule } from '../platform-payouts/platform-payouts.module';

@Module({
  imports: [
    EmailModule,
    OrganizationsModule,
    UsersModule,
    TransactionsModule,
    PlatformPayoutsModule,
  ],
  controllers: [
    PlatformAdminController,
    PublicPlatformStaffInvitationsController,
    AdminOrganizationsController,
    AdminUsersController,
    AdminTransactionsController,
    AdminDisputesController,
    AdminPlatformPayoutsController,
  ],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
