import { IsNumber, IsPositive } from 'class-validator';

export class AllocateBudgetDto {
  @IsNumber()
  @IsPositive()
  amount!: number;
}
