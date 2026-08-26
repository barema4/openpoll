import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsService } from './payments.service';
import { CheckoutController } from './checkout.controller';
import { WebhookController } from './webhook.controller';
import { WebhookProcessor } from './webhook.processor';
import { PaystackProvider } from './providers/paystack.provider';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { WEBHOOK_QUEUE } from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: WEBHOOK_QUEUE },
      { name: PERSONAL_INVOICE_WEBHOOK_QUEUE },
    ),
  ],
  controllers: [CheckoutController, WebhookController],
  providers: [
    PaymentsService,
    WebhookProcessor,
    PaystackProvider,
    { provide: PAYMENT_PROVIDER, useExisting: PaystackProvider },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
