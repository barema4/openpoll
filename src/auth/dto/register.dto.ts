import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { SUPPORTED_COUNTRIES } from '../../config/supported-countries';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // ISO-3166-1 alpha-2 code — determines which payment provider/currency
  // this user's personal invoices use (see SUPPORTED_COUNTRIES). The
  // frontend pre-fills this from IP-based geolocation; omitted falls back
  // to the schema default (Kenya) via UsersService/User.country.
  @IsOptional()
  @IsIn(Object.keys(SUPPORTED_COUNTRIES))
  country?: string;

  // Raw token from an organization-invitation email link (?invite=...). If it
  // resolves to a valid, matching-email pending invitation, registration also
  // creates the corresponding OrganizationMembership. Never blocks
  // registration if invalid/stale/mismatched.
  @IsOptional()
  @IsString()
  inviteToken?: string;

  // Same idea, for a platform-staff invitation (?staffInvite=...) — grants
  // platformRole: STAFF instead of an OrganizationMembership.
  @IsOptional()
  @IsString()
  staffInviteToken?: string;
}
