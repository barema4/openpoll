import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import {
  OrganizationCountry,
  OrganizationType,
} from '../../../../generated/prisma/enums';

export class CreateClientOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  @IsOptional()
  @IsEnum(OrganizationCountry)
  country?: OrganizationCountry;
}
