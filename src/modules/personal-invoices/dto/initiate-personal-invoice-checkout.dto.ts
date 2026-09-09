import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from '../../payments/providers/payment-provider.interface';

// No `amount` field — a personal invoice demands one fixed amount set by the
// issuer, unlike an event permanent link where the payer picks the amount.
export class InitiatePersonalInvoiceCheckoutDto {
  @IsEmail()
  payerEmail!: string;

  @IsOptional()
  @IsString()
  payerName?: string;

  @IsOptional()
  @IsString()
  payerPhone?: string;

  // Which channel the payer picked (card vs M-Pesa/mobile money) — see
  // InitiateCheckoutDto for the full rationale.
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;
}
