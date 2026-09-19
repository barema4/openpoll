import { IsEnum, IsUUID } from 'class-validator';
import { OrgRole } from '../../../../generated/prisma/enums';

export class GrantClientAccessDto {
  @IsUUID()
  userId!: string;

  @IsEnum(OrgRole)
  role!: OrgRole;
}
