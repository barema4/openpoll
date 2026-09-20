import { Module } from '@nestjs/common';
import { BudgetTemplatesService } from './budget-templates.service';
import { BudgetTemplatesController } from './budget-templates.controller';
import { BudgetCategoriesModule } from '../budget-categories/budget-categories.module';

@Module({
  imports: [BudgetCategoriesModule],
  controllers: [BudgetTemplatesController],
  providers: [BudgetTemplatesService],
  exports: [BudgetTemplatesService],
})
export class BudgetTemplatesModule {}
