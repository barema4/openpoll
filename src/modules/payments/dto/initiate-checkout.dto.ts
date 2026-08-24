import { IsEmail, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class InitiateCheckoutDto {
  @IsEmail()
  email!: string;

  // Required when the invoice/permanent link has no fixed amountRequested.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}
