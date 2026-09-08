import { OrganizationsService } from './organizations.service';
import { OrgRole } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { ConfigService } from '@nestjs/config';
import type { EmailService } from '../../email/email.service';

describe('OrganizationsService.listForUser', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const config = {} as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

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
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

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
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    expect(await service.listForUser('user-2')).toEqual([]);
  });
});

describe('OrganizationsService.getOrCreatePersonalOrg', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const config = {} as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

  it('reuses an existing personal organization instead of creating a new one', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      organization: { id: 'org-existing', isPersonal: true },
    });
    const create = jest.fn();
    const prisma = {
      organizationMembership: { findFirst },
      organization: { create },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

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
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

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

describe('OrganizationsService.inviteMember', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const config = {
    get: jest.fn().mockReturnValue('http://localhost:5173'),
  } as unknown as ConfigService;

  it('creates a pending invitation and emails a sign-up link when no account exists for the email', async () => {
    const emailSend = jest.fn();
    const email = { send: emailSend } as unknown as EmailService;
    const invitationCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      organization: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ name: 'Grace Chapel' }),
      },
      organizationInvitation: { create: invitationCreate },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    const result = await service.inviteMember('actor-1', 'org-1', {
      email: 'newperson@example.com',
      role: OrgRole.TREASURER,
    });

    expect(result).toEqual({
      status: 'invited',
      email: 'newperson@example.com',
      role: OrgRole.TREASURER,
    });
    expect(invitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          email: 'newperson@example.com',
          role: OrgRole.TREASURER,
        }),
      }),
    );
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'newperson@example.com' }),
    );
  });

  it('creates the membership directly when an account already exists for the email', async () => {
    const emailSend = jest.fn();
    const email = { send: emailSend } as unknown as EmailService;
    const membershipCreate = jest
      .fn()
      .mockResolvedValue({ id: 'membership-1' });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-2' }) },
      organizationMembership: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: membershipCreate,
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    const result = await service.inviteMember('actor-1', 'org-1', {
      email: 'existing@example.com',
      role: OrgRole.AUDITOR,
    });

    expect(result).toEqual({ id: 'membership-1' });
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.getInvitationPreview', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const config = {} as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

  it('throws NotFoundException when the token matches no invitation', async () => {
    const prisma = {
      organizationInvitation: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    await expect(service.getInvitationPreview('bad-token')).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws GoneException when the invitation has expired', async () => {
    const prisma = {
      organizationInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 60_000),
          role: OrgRole.TREASURER,
          email: 'jane@example.com',
          organization: { name: 'Grace Chapel' },
        }),
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    await expect(service.getInvitationPreview('expired-token')).rejects.toThrow(
      /expired/i,
    );
  });

  it('returns organization/role/email for a valid pending invitation', async () => {
    const prisma = {
      organizationInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 60_000),
          role: OrgRole.TREASURER,
          email: 'jane@example.com',
          organization: { name: 'Grace Chapel' },
        }),
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      config,
      email,
    );

    const result = await service.getInvitationPreview('valid-token');

    expect(result).toEqual({
      organizationName: 'Grace Chapel',
      role: OrgRole.TREASURER,
      email: 'jane@example.com',
    });
  });
});
