import { IsEmail } from 'class-validator';

export class InviteStaffDto {
  @IsEmail()
  email!: string;
}
