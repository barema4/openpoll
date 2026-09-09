import { IsBoolean } from 'class-validator';

export class UpdateEventBudgetingDto {
  @IsBoolean()
  enabled!: boolean;
}
