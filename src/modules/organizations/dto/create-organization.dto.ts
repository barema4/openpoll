import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { OrganizationType } from '../../../../generated/prisma/enums';
import { SUPPORTED_COUNTRIES } from '../../../config/supported-countries';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  // ISO-3166-1 alpha-2 code — determines the payment provider/currency for
  // every event this org creates (see SUPPORTED_COUNTRIES). Defaults to
  // Kenya/Paystack if omitted.
  @IsOptional()
  @IsIn(Object.keys(SUPPORTED_COUNTRIES))
  country?: string;
}
