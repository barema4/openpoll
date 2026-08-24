import { SetMetadata } from '@nestjs/common';
import type { OrgRole } from '../../../generated/prisma/enums';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
