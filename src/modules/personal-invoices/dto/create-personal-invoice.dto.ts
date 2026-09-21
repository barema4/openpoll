import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreatePersonalInvoiceDto {
  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  // Defaults to 30 days — see DEFAULT_EXPIRY_DAYS in personal-invoices.service.ts.
  @IsOptional()
  @IsInt()
  @IsPositive()
  expiresInDays?: number;

  // Purely a label — "this invoice was for planning this client's event" —
  // for an event company billing a client it manages. The caller must have
  // access to this org (direct membership or an agency grant); doesn't
  // change who's actually billed (still the named recipient above).
  @IsOptional()
  @IsUUID()
  relatedOrganizationId?: string;
}
