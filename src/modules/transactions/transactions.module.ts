import { Module, forwardRef } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PublicReceiptsController } from './public-receipts.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // forwardRef: PaymentsModule's webhook controllers need TransactionsService
  // (to complete a refund once it lands), and this module needs PaymentsModule
  // for the two payment providers (to initiate one) — a genuine two-way
  // dependency between the two modules.
  imports: [forwardRef(() => PaymentsModule)],
  controllers: [TransactionsController, PublicReceiptsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
