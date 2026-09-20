import type { PrismaService } from '../prisma/prisma.service';

// Organization ids allowed to "own" something reusable across an agency's
// client roster (vendors, budget templates) — the org itself, plus
// whichever agency manages it, if any. See AgencyClientLink.
export async function resolveOwnerOrganizationIds(
  prisma: PrismaService,
  organizationId: string,
): Promise<string[]> {
  const link = await prisma.agencyClientLink.findUnique({
    where: { clientOrganizationId: organizationId },
    select: { agencyOrganizationId: true },
  });
  return link ? [organizationId, link.agencyOrganizationId] : [organizationId];
}

// Whether `candidateOwnerOrganizationId` may own something usable by
// `organizationId` — either the same org, or the agency managing it.
export async function isOwnerOrganization(
  prisma: PrismaService,
  organizationId: string,
  candidateOwnerOrganizationId: string,
): Promise<boolean> {
  if (candidateOwnerOrganizationId === organizationId) return true;
  const link = await prisma.agencyClientLink.findUnique({
    where: { clientOrganizationId: organizationId },
    select: { agencyOrganizationId: true },
  });
  return link?.agencyOrganizationId === candidateOwnerOrganizationId;
}
