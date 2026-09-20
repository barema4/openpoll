import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Exactly one of percentage/fixedAmount should be set — enforced in
// BudgetTemplatesService.create, not here, since it depends on both fields
// together rather than either one in isolation.
export class BudgetTemplateItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  percentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedAmount?: number;
}
