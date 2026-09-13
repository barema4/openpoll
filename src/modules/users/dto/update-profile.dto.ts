import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { OrganizationCountry } from '../../../../generated/prisma/enums';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Determines which payment provider personal invoices use. Only settable
  // while no payout destination is configured yet — see UsersService.
  @IsOptional()
  @IsEnum(OrganizationCountry)
  country?: OrganizationCountry;
}
