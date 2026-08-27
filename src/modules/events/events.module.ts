import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PayoutsModule } from '../payouts/payouts.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [PayoutsModule, InvoicesModule, OrganizationsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
