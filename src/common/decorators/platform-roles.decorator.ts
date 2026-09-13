import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '../../../generated/prisma/enums';

export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: PlatformRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);
