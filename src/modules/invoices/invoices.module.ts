import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { PublicInvoicesController } from './public-invoices.controller';
import { PublicEventContributorsController } from './public-event-contributors.controller';

@Module({
  controllers: [
    InvoicesController,
    PublicInvoicesController,
    PublicEventContributorsController,
  ],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
