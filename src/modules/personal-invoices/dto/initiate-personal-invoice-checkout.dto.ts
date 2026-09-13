import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import {
  MOBILE_MONEY_PROVIDERS,
  PAYMENT_METHODS,
  type MobileMoneyProvider,
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

  // Kenya: card vs M-Pesa/mobile money (Paystack). Uganda: which network —
  // required together with phoneNumber below, since PawaPay has no hosted
  // page to collect it on. See InitiateCheckoutDto for the full rationale.
  @IsOptional()
  @IsIn([...PAYMENT_METHODS, ...MOBILE_MONEY_PROVIDERS])
  paymentMethod?: PaymentMethod | MobileMoneyProvider;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
