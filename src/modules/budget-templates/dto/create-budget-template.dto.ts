import {
  ArrayMinSize,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BudgetTemplateItemDto } from './budget-template-item.dto';

export class CreateBudgetTemplateDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BudgetTemplateItemDto)
  items!: BudgetTemplateItemDto[];
}
