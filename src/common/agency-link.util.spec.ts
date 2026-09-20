import {
  resolveOwnerOrganizationIds,
  isOwnerOrganization,
} from './agency-link.util';
import type { PrismaService } from '../prisma/prisma.service';

describe('resolveOwnerOrganizationIds', () => {
  it('returns just the org itself when no agency manages it', async () => {
    const prisma = {
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    expect(await resolveOwnerOrganizationIds(prisma, 'org-1')).toEqual([
      'org-1',
    ]);
  });

  it('includes the managing agency when one exists', async () => {
    const prisma = {
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
    } as unknown as PrismaService;

    expect(await resolveOwnerOrganizationIds(prisma, 'client-org-1')).toEqual([
      'client-org-1',
      'agency-org-1',
    ]);
  });
});

describe('isOwnerOrganization', () => {
  it('is true when the candidate is the org itself', async () => {
    const prisma = {
      agencyClientLink: { findUnique: jest.fn() },
    } as unknown as PrismaService;

    expect(await isOwnerOrganization(prisma, 'org-1', 'org-1')).toBe(true);
  });

  it('is true when the candidate is the agency managing the org', async () => {
    const prisma = {
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
    } as unknown as PrismaService;

    expect(
      await isOwnerOrganization(prisma, 'client-org-1', 'agency-org-1'),
    ).toBe(true);
  });

  it('is false for an unrelated organization', async () => {
    const prisma = {
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    expect(await isOwnerOrganization(prisma, 'org-1', 'org-2')).toBe(false);
  });
});
