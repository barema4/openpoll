import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID()
  eventId!: string;

  @IsOptional()
  @IsString()
  contributorName?: string;

  @IsOptional()
  @IsEmail()
  contributorEmail?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountRequested?: number;

  @IsOptional()
  @IsString()
  categoryTag?: string;

  // Permanent, non-expiring multi-use link (e.g. tithes, monthly dues).
  @IsOptional()
  @IsBoolean()
  isPermanent?: boolean;

  // Only applies when isPermanent is false. Defaults to 30 days.
  @IsOptional()
  @IsInt()
  @IsPositive()
  expiresInDays?: number;
}
