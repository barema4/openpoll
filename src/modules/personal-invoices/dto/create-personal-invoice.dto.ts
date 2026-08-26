import {
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
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
}
