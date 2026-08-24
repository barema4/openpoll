import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class AllocateTransactionDto {
  @IsUUID()
  transactionId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
