import { Module } from '@nestjs/common';
import { BudgetApprovalsService } from './budget-approvals.service';
import { BudgetApprovalsController } from './budget-approvals.controller';

@Module({
  controllers: [BudgetApprovalsController],
  providers: [BudgetApprovalsService],
  exports: [BudgetApprovalsService],
})
export class BudgetApprovalsModule {}
