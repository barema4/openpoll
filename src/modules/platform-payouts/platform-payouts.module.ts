import { Module, forwardRef } from '@nestjs/common';
import { PlatformPayoutsService } from './platform-payouts.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // forwardRef: PaymentsModule's webhook controller needs
  // PlatformPayoutsService (to complete a platform withdrawal once its
  // callback lands); this module needs PawaPayProvider from PaymentsModule
  // (to initiate one) — the same two-way relationship TransactionsModule
  // already has with PaymentsModule, for the same reason.
  imports: [forwardRef(() => PaymentsModule)],
  providers: [PlatformPayoutsService],
  exports: [PlatformPayoutsService],
})
export class PlatformPayoutsModule {}
