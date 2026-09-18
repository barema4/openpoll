import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideBudgetDto {
  @IsBoolean()
  approve!: boolean;

  // Required when declining — enforced in the service (a business rule, not
  // a format rule), matching how e.g. "amount exceeds remaining balance" is
  // enforced in BudgetCategoriesService.allocate rather than at the DTO layer.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
