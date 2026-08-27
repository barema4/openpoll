import { IsEnum, IsString, MinLength } from 'class-validator';
import { OrganizationType } from '../../../../generated/prisma/enums';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(OrganizationType)
  type!: OrganizationType;
}
