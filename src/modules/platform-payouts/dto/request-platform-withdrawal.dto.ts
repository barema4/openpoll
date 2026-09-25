import { IsNumber, IsPositive } from 'class-validator';

export class RequestPlatformWithdrawalDto {
  @IsNumber()
  @IsPositive()
  amount!: number;
}
