import { ForbiddenException } from '@nestjs/common';
import { PlatformRolesGuard } from './platform-roles.guard';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';

function makeContext(userId: string | undefined) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { id: userId } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(requiredRoles: PlatformRole[] | undefined) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
}

function makePrisma(user: {
  email: string;
  platformRole: PlatformRole | null;
}) {
  return {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
  } as unknown as PrismaService;
}

function makeConfig(operatorEmail: string | undefined) {
  return {
    get: jest.fn().mockReturnValue(operatorEmail),
  } as unknown as ConfigService;
}

describe('PlatformRolesGuard', () => {
  it('is a no-op when the handler has no @PlatformRoles metadata', async () => {
    const guard = new PlatformRolesGuard(
      makeReflector(undefined),
      makePrisma({ email: 'x@example.com', platformRole: null }),
      makeConfig(undefined),
    );

    await expect(guard.canActivate(makeContext('user-1'))).resolves.toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    const guard = new PlatformRolesGuard(
      makeReflector([PlatformRole.OWNER]),
      makePrisma({ email: 'x@example.com', platformRole: null }),
      makeConfig(undefined),
    );

    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a user whose DB role is in the required list', async () => {
    const guard = new PlatformRolesGuard(
      makeReflector([PlatformRole.OWNER, PlatformRole.STAFF]),
      makePrisma({
        email: 'staff@example.com',
        platformRole: PlatformRole.STAFF,
      }),
      makeConfig(undefined),
    );

    await expect(guard.canActivate(makeContext('user-1'))).resolves.toBe(true);
  });

  it('rejects a user whose role is not in the required list', async () => {
    const guard = new PlatformRolesGuard(
      makeReflector([PlatformRole.OWNER]),
      makePrisma({
        email: 'staff@example.com',
        platformRole: PlatformRole.STAFF,
      }),
      makeConfig(undefined),
    );

    await expect(guard.canActivate(makeContext('user-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the operator-email fallback even with no DB role', async () => {
    const guard = new PlatformRolesGuard(
      makeReflector([PlatformRole.OWNER]),
      makePrisma({ email: 'owner@example.com', platformRole: null }),
      makeConfig('owner@example.com'),
    );

    await expect(guard.canActivate(makeContext('user-1'))).resolves.toBe(true);
  });
});
