import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsService } from './payments.service';
import { CheckoutController } from './checkout.controller';
import { DepositsController } from './deposits.controller';
import { WebhookController } from './webhook.controller';
import { PawaPayWebhookController } from './pawapay-webhook.controller';
import { WebhookProcessor } from './webhook.processor';
import { RefundWebhookProcessor } from './refund-webhook.processor';
import { DisputeWebhookProcessor } from './dispute-webhook.processor';
import { PaystackProvider } from './providers/paystack.provider';
import { PawaPayProvider } from './providers/pawapay.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import {
  PAWAPAY_PROVIDER,
  PAYSTACK_PROVIDER,
} from './providers/payment-provider.interface';
import {
  WEBHOOK_QUEUE,
  REFUND_WEBHOOK_QUEUE,
  DISPUTE_WEBHOOK_QUEUE,
} from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: WEBHOOK_QUEUE },
      { name: PERSONAL_INVOICE_WEBHOOK_QUEUE },
      { name: REFUND_WEBHOOK_QUEUE },
      { name: DISPUTE_WEBHOOK_QUEUE },
    ),
    // forwardRef: TransactionsModule needs the two providers from here (to
    // initiate a refund); the webhook controllers/processor here need
    // TransactionsService (to complete one once it lands) — a genuine
    // two-way dependency between the two modules.
    forwardRef(() => TransactionsModule),
  ],
  controllers: [
    CheckoutController,
    DepositsController,
    WebhookController,
    PawaPayWebhookController,
  ],
  providers: [
    PaymentsService,
    WebhookProcessor,
    RefundWebhookProcessor,
    DisputeWebhookProcessor,
    PaystackProvider,
    PawaPayProvider,
    PaymentProviderRegistry,
    { provide: PAYSTACK_PROVIDER, useExisting: PaystackProvider },
    { provide: PAWAPAY_PROVIDER, useExisting: PawaPayProvider },
  ],
  // PAYSTACK_PROVIDER stays exported for the Kenya-only, bank-shaped
  // consumer (PayoutsModule) that has no equivalent PawaPay path.
  // PawaPayProvider is exported concretely for WithdrawalsModule (payouts
  // have no Paystack equivalent, so there's no shared-interface abstraction
  // to inject instead). PaystackProvider is also exported concretely for
  // DisbursementsModule's Kenya bank-account vendor transfers
  // (BankAccountVendorPayoutProvider). PaymentProviderRegistry is exported
  // for any country-aware charging consumer outside this module
  // (PersonalInvoicesModule).
  exports: [
    PAYSTACK_PROVIDER,
    PaystackProvider,
    PawaPayProvider,
    PaymentProviderRegistry,
  ],
})
export class PaymentsModule {}
