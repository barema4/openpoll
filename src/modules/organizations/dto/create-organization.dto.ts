import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import {
  OrganizationCountry,
  OrganizationType,
} from '../../../../generated/prisma/enums';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  // Determines the payment provider/currency for every event this org
  // creates. Defaults to Kenya/Paystack if omitted.
  @IsOptional()
  @IsEnum(OrganizationCountry)
  country?: OrganizationCountry;
}
