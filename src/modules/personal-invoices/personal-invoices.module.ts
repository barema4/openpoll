import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PersonalInvoicesService } from './personal-invoices.service';
import { PersonalInvoicesController } from './personal-invoices.controller';
import { PublicPersonalInvoicesController } from './public-personal-invoices.controller';
import { PersonalInvoiceWebhookProcessor } from './personal-invoice-webhook.processor';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from './personal-invoices.constants';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: PERSONAL_INVOICE_WEBHOOK_QUEUE }),
    PaymentsModule,
  ],
  controllers: [PersonalInvoicesController, PublicPersonalInvoicesController],
  providers: [PersonalInvoicesService, PersonalInvoiceWebhookProcessor],
  exports: [PersonalInvoicesService],
})
export class PersonalInvoicesModule {}
