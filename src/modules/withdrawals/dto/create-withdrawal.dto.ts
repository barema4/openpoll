import { IsNumber, IsPositive } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  amount!: number;
}
