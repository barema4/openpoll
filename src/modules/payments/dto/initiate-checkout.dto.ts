import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from '../providers/payment-provider.interface';

export class InitiateCheckoutDto {
  @IsEmail()
  email!: string;

  // Required when the invoice/permanent link has no fixed amountRequested.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  // Optional payer-supplied identity, saved onto the invoice if it isn't
  // already set (e.g. an open link, or a pledge being paid off).
  @IsOptional()
  @IsString()
  contributorName?: string;

  @IsOptional()
  @IsString()
  contributorPhone?: string;

  // Which channel the payer picked on our own pay page (card vs M-Pesa/mobile
  // money) — passed through to Paystack so its hosted checkout skips
  // straight to it instead of showing its own channel picker. Omit to let
  // Paystack offer everything enabled for the account.
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;
}
