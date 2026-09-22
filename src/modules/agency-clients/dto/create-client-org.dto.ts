import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { OrganizationType } from '../../../../generated/prisma/enums';
import { SUPPORTED_COUNTRIES } from '../../../config/supported-countries';

export class CreateClientOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  @IsOptional()
  @IsIn(Object.keys(SUPPORTED_COUNTRIES))
  country?: string;
}
