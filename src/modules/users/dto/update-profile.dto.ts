import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { SUPPORTED_COUNTRIES } from '../../../config/supported-countries';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // ISO-3166-1 alpha-2 code — determines which payment provider personal
  // invoices use (see SUPPORTED_COUNTRIES). Only settable while no payout
  // destination is configured yet — see UsersService.
  @IsOptional()
  @IsIn(Object.keys(SUPPORTED_COUNTRIES))
  country?: string;
}
