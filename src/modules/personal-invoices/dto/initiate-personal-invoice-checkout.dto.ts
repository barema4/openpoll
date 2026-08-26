import { IsEmail, IsOptional, IsString } from 'class-validator';

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
}
