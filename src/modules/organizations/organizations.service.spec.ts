import { OrganizationsService } from './organizations.service';
import { OrgRole } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

describe('OrganizationsService.listForUser', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  it("flattens memberships into organizations tagged with the caller's role", async () => {
    const memberships = [
      {
        role: OrgRole.MAIN_ORGANIZER,
        organization: { id: 'org-1', name: 'Grace Chapel', type: 'CHURCH' },
      },
      {
        role: OrgRole.AUDITOR,
        organization: { id: 'org-2', name: 'Family Chama', type: 'CHAMA' },
      },
    ];
    const findMany = jest.fn().mockResolvedValue(memberships);
    const prisma = {
      organizationMembership: { findMany },
    } as unknown as PrismaService;
    const service = new OrganizationsService(prisma, audit);

    const result = await service.listForUser('user-1');

    expect(result).toEqual([
      {
        id: 'org-1',
        name: 'Grace Chapel',
        type: 'CHURCH',
        role: OrgRole.MAIN_ORGANIZER,
      },
      {
        id: 'org-2',
        name: 'Family Chama',
        type: 'CHAMA',
        role: OrgRole.AUDITOR,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('returns an empty array for a user with no memberships', async () => {
    const prisma = {
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new OrganizationsService(prisma, audit);

    expect(await service.listForUser('user-2')).toEqual([]);
  });
});
