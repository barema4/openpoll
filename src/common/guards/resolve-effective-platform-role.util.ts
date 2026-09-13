import { ConfigService } from '@nestjs/config';
import { PlatformRole } from '../../../generated/prisma/enums';

// Falls back to OWNER for the configured operator email regardless of what's
// stored on the User row — so the founder's own access can never be locked
// out by a DB mistake, while every other staff member's access is purely
// DB/invite-driven.
export function resolveEffectivePlatformRole(
  user: { email: string; platformRole: PlatformRole | null },
  config: ConfigService,
): PlatformRole | null {
  if (user.platformRole) return user.platformRole;

  const operatorEmail = config.get<string>('PLATFORM_OPERATOR_EMAIL');
  if (
    operatorEmail &&
    user.email.toLowerCase() === operatorEmail.toLowerCase()
  ) {
    return PlatformRole.OWNER;
  }

  return null;
}
