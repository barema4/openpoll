import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

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
}
