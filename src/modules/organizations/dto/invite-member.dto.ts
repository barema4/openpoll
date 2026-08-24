import { IsEmail, IsEnum } from 'class-validator';
import { OrgRole } from '../../../../generated/prisma/enums';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(OrgRole)
  role!: OrgRole;
}
