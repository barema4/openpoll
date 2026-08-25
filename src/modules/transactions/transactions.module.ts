import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PublicReceiptsController } from './public-receipts.controller';

@Module({
  controllers: [TransactionsController, PublicReceiptsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
