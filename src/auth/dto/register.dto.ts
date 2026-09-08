import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // Raw token from an organization-invitation email link (?invite=...). If it
  // resolves to a valid, matching-email pending invitation, registration also
  // creates the corresponding OrganizationMembership. Never blocks
  // registration if invalid/stale/mismatched.
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
