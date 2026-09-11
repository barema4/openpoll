import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsService } from './payments.service';
import { CheckoutController } from './checkout.controller';
import { WebhookController } from './webhook.controller';
import { PawaPayWebhookController } from './pawapay-webhook.controller';
import { WebhookProcessor } from './webhook.processor';
import { PaystackProvider } from './providers/paystack.provider';
import { PawaPayProvider } from './providers/pawapay.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import {
  PAWAPAY_PROVIDER,
  PAYSTACK_PROVIDER,
} from './providers/payment-provider.interface';
import { WEBHOOK_QUEUE } from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: WEBHOOK_QUEUE },
      { name: PERSONAL_INVOICE_WEBHOOK_QUEUE },
    ),
  ],
  controllers: [
    CheckoutController,
    WebhookController,
    PawaPayWebhookController,
  ],
  providers: [
    PaymentsService,
    WebhookProcessor,
    PaystackProvider,
    PawaPayProvider,
    PaymentProviderRegistry,
    { provide: PAYSTACK_PROVIDER, useExisting: PaystackProvider },
    { provide: PAWAPAY_PROVIDER, useExisting: PawaPayProvider },
  ],
  // PAYSTACK_PROVIDER stays exported for the Kenya-only, bank-shaped
  // consumers (PayoutsModule, PersonalInvoicesModule) that have no
  // equivalent PawaPay path yet. PawaPayProvider is exported concretely for
  // WithdrawalsModule (payouts have no Paystack equivalent, so there's no
  // shared-interface abstraction to inject instead).
  exports: [PAYSTACK_PROVIDER, PaystackProvider, PawaPayProvider],
})
export class PaymentsModule {}
