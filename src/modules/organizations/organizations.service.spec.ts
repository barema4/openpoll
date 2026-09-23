import { OrganizationsService } from './organizations.service';
import { OrgRole } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { StripeConnectService } from '../stripe-connect/stripe-connect.service';
import type { ConfigService } from '@nestjs/config';
import type { EmailService } from '../../email/email.service';

describe('OrganizationsService.listForUser', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const stripeConnect = {} as unknown as StripeConnectService;
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
    const findManyAgencyAccess = jest.fn().mockResolvedValue([]);
    const prisma = {
      organizationMembership: { findMany },
      agencyClientAccess: { findMany: findManyAgencyAccess },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
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
        payoutMobileNumberLast4: null,
      },
      {
        id: 'org-2',
        name: 'Family Chama',
        type: 'CHAMA',
        role: OrgRole.AUDITOR,
        payoutMobileNumberLast4: null,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('returns an empty array for a user with no memberships', async () => {
    const prisma = {
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
      agencyClientAccess: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    expect(await service.listForUser('user-2')).toEqual([]);
  });

  it('appends client orgs granted via AgencyClientAccess, tagged with managedViaAgency', async () => {
    const prisma = {
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
      agencyClientAccess: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: OrgRole.TREASURER,
            clientOrganizationId: 'client-org-1',
            clientOrganization: { id: 'client-org-1', name: 'Client Co' },
            agencyOrganization: { id: 'agency-org-1', name: 'Acme Events' },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.listForUser('user-1');

    expect(result).toEqual([
      {
        id: 'client-org-1',
        name: 'Client Co',
        role: OrgRole.TREASURER,
        payoutMobileNumberLast4: null,
        managedViaAgency: { id: 'agency-org-1', name: 'Acme Events' },
      },
    ]);
  });

  it('prefers a direct membership over an agency grant for the same organization', async () => {
    const prisma = {
      organizationMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: OrgRole.MAIN_ORGANIZER,
            organizationId: 'org-1',
            organization: { id: 'org-1', name: 'Org One' },
          },
        ]),
      },
      agencyClientAccess: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: OrgRole.AUDITOR,
            clientOrganizationId: 'org-1',
            clientOrganization: { id: 'org-1', name: 'Org One' },
            agencyOrganization: { id: 'agency-org-1', name: 'Acme Events' },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.listForUser('user-1');

    expect(result).toEqual([
      {
        id: 'org-1',
        name: 'Org One',
        role: OrgRole.MAIN_ORGANIZER,
        payoutMobileNumberLast4: null,
      },
    ]);
  });
});

describe('OrganizationsService.getOrCreatePersonalOrg', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const stripeConnect = {} as unknown as StripeConnectService;
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
      stripeConnect,
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
      stripeConnect,
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

  it('scopes the lookup by country, so an existing Kenya personal org is not reused for a Uganda quick collection', async () => {
    const findFirst = jest.fn().mockResolvedValue(null); // no Uganda personal org exists yet
    const create = jest.fn().mockResolvedValue({
      id: 'org-ug',
      name: "Jane Doe's Workspace (Uganda)",
      country: 'UG',
    });
    const prisma = {
      organizationMembership: { findFirst },
      organization: { create },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.getOrCreatePersonalOrg(
      'user-1',
      'Jane Doe',
      'UG',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          organization: { isPersonal: true, country: 'UG' },
        },
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Jane Doe's Workspace (Uganda)",
          country: 'UG',
          isPersonal: true,
        }),
      }),
    );
    expect(result).toEqual({
      id: 'org-ug',
      name: "Jane Doe's Workspace (Uganda)",
      country: 'UG',
    });
  });
});

describe('OrganizationsService.inviteMember', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const stripeConnect = {} as unknown as StripeConnectService;
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
      stripeConnect,
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
      stripeConnect,
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
  const stripeConnect = {} as unknown as StripeConnectService;
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
      stripeConnect,
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
      stripeConnect,
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
      stripeConnect,
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

describe('OrganizationsService.setMobileMoneyPayout', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const stripeConnect = {} as unknown as StripeConnectService;
  const config = {} as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

  it('rejects a Kenya organization', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ country: 'KE' }),
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    await expect(
      service.setMobileMoneyPayout('user-1', 'org-1', {
        provider: 'MTN_MOMO_UGA',
        phoneNumber: '256771234567',
      }),
    ).rejects.toThrow(
      /only available for organizations on the PawaPay payout rail/i,
    );
  });

  it('stores the provider/number and masks the number to last 4 in the response', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'org-1',
      payoutMobileNumber: '256771234567',
    });
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ country: 'UG' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.setMobileMoneyPayout('user-1', 'org-1', {
      provider: 'MTN_MOMO_UGA',
      phoneNumber: '256771234567',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          payoutMobileProvider: 'MTN_MOMO_UGA',
          payoutMobileNumber: '256771234567',
        },
      }),
    );
    expect(result).not.toHaveProperty('payoutMobileNumber');
    expect(result).toMatchObject({
      id: 'org-1',
      payoutMobileNumberLast4: '4567',
    });
  });
});

describe('OrganizationsService.createStripeConnectOnboardingLink', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const config = {
    get: jest.fn(() => 'http://localhost:5173'),
  } as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

  it('creates a Stripe account and persists it when the org has none yet', async () => {
    const update = jest.fn();
    const prisma = {
      organization: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ stripeConnectAccountId: null }),
        update,
      },
    } as unknown as PrismaService;
    const ensureAccount = jest.fn().mockResolvedValue('acct_new');
    const createOnboardingLink = jest
      .fn()
      .mockResolvedValue('https://connect.stripe.com/setup/abc');
    const stripeConnect = {
      ensureAccount,
      createOnboardingLink,
    } as unknown as StripeConnectService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.createStripeConnectOnboardingLink(
      'user-1',
      'org-1',
    );

    expect(ensureAccount).toHaveBeenCalledWith({
      existingAccountId: null,
      ownerType: 'ORGANIZATION',
      ownerId: 'org-1',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { stripeConnectAccountId: 'acct_new' },
    });
    expect(result).toEqual({ url: 'https://connect.stripe.com/setup/abc' });
  });

  it('reuses an existing Stripe account without writing to the database again', async () => {
    const update = jest.fn();
    const prisma = {
      organization: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ stripeConnectAccountId: 'acct_existing' }),
        update,
      },
    } as unknown as PrismaService;
    const stripeConnect = {
      ensureAccount: jest.fn().mockResolvedValue('acct_existing'),
      createOnboardingLink: jest
        .fn()
        .mockResolvedValue('https://connect.stripe.com/setup/xyz'),
    } as unknown as StripeConnectService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    await service.createStripeConnectOnboardingLink('user-1', 'org-1');

    expect(update).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.setBranding', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;
  const payouts = {} as unknown as PayoutsService;
  const stripeConnect = {} as unknown as StripeConnectService;
  const config = {} as unknown as ConfigService;
  const email = { send: jest.fn() } as unknown as EmailService;

  it('sets the logo URL', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'org-1',
      logoUrl: 'https://example.com/logo.png',
    });
    const prisma = { organization: { update } } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    const result = await service.setBranding('user-1', 'org-1', {
      logoUrl: 'https://example.com/logo.png',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { logoUrl: 'https://example.com/logo.png' },
    });
    expect(result).toMatchObject({ logoUrl: 'https://example.com/logo.png' });
  });

  it('clears the logo URL when omitted', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'org-1', logoUrl: null });
    const prisma = { organization: { update } } as unknown as PrismaService;
    const service = new OrganizationsService(
      prisma,
      audit,
      payouts,
      stripeConnect,
      config,
      email,
    );

    await service.setBranding('user-1', 'org-1', {});

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { logoUrl: null },
    });
  });
});
