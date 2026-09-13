import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_ROLES_KEY } from '../decorators/platform-roles.decorator';
import { resolveEffectivePlatformRole } from './resolve-effective-platform-role.util';
import type { PlatformRole } from '../../../generated/prisma/enums';

// Platform-level access (reconciliation, staff management) — distinct from
// OrgRolesGuard, which resolves an organization from the request. There is
// no organization here, just "does this user have a platform role at all,
// and is it one of the ones this handler requires."
@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<PlatformRole[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, platformRole: true },
    });
    const effectiveRole = resolveEffectivePlatformRole(user, this.config);

    if (!effectiveRole || !requiredRoles.includes(effectiveRole)) {
      throw new ForbiddenException('Not authorized for this route');
    }

    return true;
  }
}
