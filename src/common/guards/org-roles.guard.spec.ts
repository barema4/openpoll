import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { OrgRolesGuard } from './org-roles.guard';
import { OrgRole } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';

function makeContext(params: Record<string, unknown>, userId = 'user-1') {
  const request = { user: { id: userId }, params, body: {}, query: {} };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OrgRolesGuard — resolving organization via vendorId', () => {
  it('resolves the organization through the vendor when only vendorId is present', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([OrgRole.MAIN_ORGANIZER]),
    } as unknown as Reflector;
    const findUnique = jest.fn().mockResolvedValue({ organizationId: 'org-1' });
    const findUniqueMembership = jest
      .fn()
      .mockResolvedValue({ role: OrgRole.MAIN_ORGANIZER });
    const prisma = {
      vendor: { findUnique },
      organizationMembership: { findUnique: findUniqueMembership },
    } as unknown as PrismaService;
    const guard = new OrgRolesGuard(reflector, prisma);

    const result = await guard.canActivate(
      makeContext({ vendorId: 'vendor-1' }),
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      select: { organizationId: true },
    });
    expect(findUniqueMembership).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: 'user-1', organizationId: 'org-1' },
      },
    });
    expect(result).toBe(true);
  });

  it('rejects when the vendor does not belong to an organization the caller has the right role in', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([OrgRole.TREASURER]),
    } as unknown as Reflector;
    const prisma = {
      vendor: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      organizationMembership: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const guard = new OrgRolesGuard(reflector, prisma);

    await expect(
      guard.canActivate(makeContext({ vendorId: 'vendor-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
