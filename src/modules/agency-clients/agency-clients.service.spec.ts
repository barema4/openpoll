import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AgencyClientsService } from './agency-clients.service';
import { OrgRole, OrganizationType } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

const audit = { record: jest.fn() } as unknown as AuditService;

describe('AgencyClientsService.createClient', () => {
  it('creates the client org, links it to the agency, and grants the creator MAIN_ORGANIZER access', async () => {
    const organizationCreate = jest
      .fn()
      .mockResolvedValue({ id: 'client-org-1', name: 'Client Co' });
    const agencyClientLinkCreate = jest.fn().mockResolvedValue({});
    const agencyClientAccessCreate = jest.fn().mockResolvedValue({});
    const tx = {
      organization: { create: organizationCreate },
      agencyClientLink: { create: agencyClientLinkCreate },
      agencyClientAccess: { create: agencyClientAccessCreate },
    };
    const prisma = {
      agencyClientLink: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    const result = await service.createClient('agency-org-1', 'user-1', {
      name: 'Client Co',
      type: OrganizationType.OTHER,
      country: 'KE',
    });

    expect(organizationCreate).toHaveBeenCalledWith({
      data: {
        name: 'Client Co',
        type: OrganizationType.OTHER,
        country: 'KE',
      },
    });
    expect(agencyClientLinkCreate).toHaveBeenCalledWith({
      data: {
        agencyOrganizationId: 'agency-org-1',
        clientOrganizationId: 'client-org-1',
      },
    });
    expect(agencyClientAccessCreate).toHaveBeenCalledWith({
      data: {
        agencyOrganizationId: 'agency-org-1',
        clientOrganizationId: 'client-org-1',
        userId: 'user-1',
        role: OrgRole.MAIN_ORGANIZER,
        grantedByUserId: 'user-1',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 'client-org-1', name: 'Client Co' }),
    );
  });

  it('allows a 2nd+ client when the agency has the plan flag on', async () => {
    const organizationCreate = jest
      .fn()
      .mockResolvedValue({ id: 'client-org-2', name: 'Client Co 2' });
    const tx = {
      organization: { create: organizationCreate },
      agencyClientLink: { create: jest.fn().mockResolvedValue({}) },
      agencyClientAccess: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      agencyClientLink: { count: jest.fn().mockResolvedValue(1) },
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ hasAgencyPlan: true }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    const result = await service.createClient('agency-org-1', 'user-1', {
      name: 'Client Co 2',
      type: OrganizationType.OTHER,
      country: 'KE',
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'client-org-2', name: 'Client Co 2' }),
    );
  });

  it('rejects a 2nd+ client when the agency plan flag is off', async () => {
    const prisma = {
      agencyClientLink: { count: jest.fn().mockResolvedValue(1) },
      organization: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ hasAgencyPlan: false }),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    await expect(
      service.createClient('agency-org-1', 'user-1', {
        name: 'Client Co 2',
        type: OrganizationType.OTHER,
        country: 'KE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgencyClientsService.listClients', () => {
  it('lists client orgs linked to the agency', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { clientOrganization: { id: 'client-org-1', name: 'Client Co' } },
      ]);
    const prisma = {
      agencyClientLink: { findMany },
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    const result = await service.listClients('agency-org-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyOrganizationId: 'agency-org-1' },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'client-org-1', name: 'Client Co' }),
    ]);
  });
});

describe('AgencyClientsService.grantAccess', () => {
  function makePrisma(opts: {
    link?: { agencyOrganizationId: string } | null;
    staffMembership?: unknown;
  }) {
    return {
      agencyClientLink: {
        findUnique: jest.fn().mockResolvedValue(opts.link ?? null),
      },
      organizationMembership: {
        findUnique: jest.fn().mockResolvedValue(opts.staffMembership ?? null),
      },
      agencyClientAccess: {
        upsert: jest.fn().mockResolvedValue({ id: 'access-1' }),
      },
    } as unknown as PrismaService;
  }

  it('grants access when the client is linked and the target user is agency staff', async () => {
    const prisma = makePrisma({
      link: { agencyOrganizationId: 'agency-org-1' },
      staffMembership: { role: OrgRole.AUDITOR },
    });
    const service = new AgencyClientsService(prisma, audit);

    const result = await service.grantAccess(
      'agency-org-1',
      'client-org-1',
      'admin-1',
      { userId: 'staff-1', role: OrgRole.TREASURER },
    );

    const upsertMock = (
      prisma as unknown as { agencyClientAccess: { upsert: jest.Mock } }
    ).agencyClientAccess.upsert;
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_clientOrganizationId: {
            userId: 'staff-1',
            clientOrganizationId: 'client-org-1',
          },
        },
        create: expect.objectContaining({
          agencyOrganizationId: 'agency-org-1',
          clientOrganizationId: 'client-org-1',
          userId: 'staff-1',
          role: OrgRole.TREASURER,
          grantedByUserId: 'admin-1',
        }) as unknown,
        update: { role: OrgRole.TREASURER, grantedByUserId: 'admin-1' },
      }),
    );
    expect(result).toEqual({ id: 'access-1' });
  });

  it('rejects when the client is not managed by this agency', async () => {
    const prisma = makePrisma({
      link: { agencyOrganizationId: 'some-other-agency' },
    });
    const service = new AgencyClientsService(prisma, audit);

    await expect(
      service.grantAccess('agency-org-1', 'client-org-1', 'admin-1', {
        userId: 'staff-1',
        role: OrgRole.TREASURER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the target user is not a member of the agency', async () => {
    const prisma = makePrisma({
      link: { agencyOrganizationId: 'agency-org-1' },
      staffMembership: null,
    });
    const service = new AgencyClientsService(prisma, audit);

    await expect(
      service.grantAccess('agency-org-1', 'client-org-1', 'admin-1', {
        userId: 'not-staff-1',
        role: OrgRole.TREASURER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgencyClientsService.revokeAccess', () => {
  it('deletes the access grant for the target user and client', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
      agencyClientAccess: { deleteMany },
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    await service.revokeAccess(
      'agency-org-1',
      'client-org-1',
      'staff-1',
      'admin-1',
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'staff-1', clientOrganizationId: 'client-org-1' },
    });
  });

  it('rejects when the client is not managed by this agency', async () => {
    const prisma = {
      agencyClientLink: { findUnique: jest.fn().mockResolvedValue(null) },
      agencyClientAccess: { deleteMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    await expect(
      service.revokeAccess(
        'agency-org-1',
        'client-org-1',
        'staff-1',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AgencyClientsService.listAccessForClient', () => {
  it('lists access grants for a linked client', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'access-1' }]);
    const prisma = {
      agencyClientLink: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ agencyOrganizationId: 'agency-org-1' }),
      },
      agencyClientAccess: { findMany },
    } as unknown as PrismaService;
    const service = new AgencyClientsService(prisma, audit);

    const result = await service.listAccessForClient(
      'agency-org-1',
      'client-org-1',
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agencyOrganizationId: 'agency-org-1',
          clientOrganizationId: 'client-org-1',
        },
      }),
    );
    expect(result).toEqual([{ id: 'access-1' }]);
  });
});
