import { OrganizationsService } from './organizations.service';
import { OrgRole } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PayoutsService } from '../payouts/payouts.service';

describe('OrganizationsService.listForUser', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;

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
    const service = new OrganizationsService(prisma, audit, payouts);

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
    const service = new OrganizationsService(prisma, audit, payouts);

    expect(await service.listForUser('user-2')).toEqual([]);
  });
});

describe('OrganizationsService.getOrCreatePersonalOrg', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;

  it('reuses an existing personal organization instead of creating a new one', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      organization: { id: 'org-existing', isPersonal: true },
    });
    const create = jest.fn();
    const prisma = {
      organizationMembership: { findFirst },
      organization: { create },
    } as unknown as PrismaService;
    const service = new OrganizationsService(prisma, audit, payouts);

    const result = await service.getOrCreatePersonalOrg('user-1', 'Jane Doe');

    expect(result).toEqual({ id: 'org-existing', isPersonal: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new personal organization named after the user when none exists', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'org-new', name: "Jane Doe's Workspace" });
    const prisma = {
      organizationMembership: { findFirst },
      organization: { create },
    } as unknown as PrismaService;
    const service = new OrganizationsService(prisma, audit, payouts);

    const result = await service.getOrCreatePersonalOrg('user-1', 'Jane Doe');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Jane Doe's Workspace",
          isPersonal: true,
        }),
      }),
    );
    expect(result).toEqual({ id: 'org-new', name: "Jane Doe's Workspace" });
  });
});
