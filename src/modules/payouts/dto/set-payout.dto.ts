import { IsString, MinLength } from 'class-validator';

// All three are required together — this is a dedicated "set my payout bank
// account" action, not a partial update, so there's no ambiguous in-between
// state where a bank code is saved without a matching account number.
export class SetPayoutDto {
  @IsString()
  @MinLength(1)
  bankCode!: string;

  @IsString()
  @MinLength(1)
  bankName!: string;

  @IsString()
  @MinLength(1)
  accountNumber!: string;
}
