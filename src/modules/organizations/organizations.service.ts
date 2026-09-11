import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmailService } from '../../email/email.service';
import { PayoutsService } from '../payouts/payouts.service';
import {
  OrgRole,
  OrganizationCountry,
  OrganizationInvitationStatus,
  OrganizationType,
} from '../../../generated/prisma/enums';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import type { SetMobileMoneyPayoutDto } from './dto/set-mobile-money-payout.dto';

// The full phone number is kept server-side (PawaPay needs it on every
// payout — there's no subaccount-style opaque token like Paystack's), but
// never returned to the client, matching the payoutAccountLast4 convention
// already used for bank payouts.
function maskPhone(organization: { payoutMobileNumber: string | null }) {
  const { payoutMobileNumber, ...rest } = organization;
  return {
    ...rest,
    payoutMobileNumberLast4: payoutMobileNumber?.slice(-4) ?? null,
  };
}

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payouts: PayoutsService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const organization = await this.prisma.organization.create({
      data: {
        name: dto.name,
        type: dto.type,
        country: dto.country ?? OrganizationCountry.KENYA,
        memberships: {
          create: { userId, role: OrgRole.MAIN_ORGANIZER },
        },
      },
      include: { memberships: true },
    });

    await this.audit.record({
      userId,
      action: 'ORGANIZATION_CREATED',
      payload: { organizationId: organization.id, name: organization.name },
    });

    return maskPhone(organization);
  }

  // Backs the "Quick collection" flow — lets a solo user create an event
  // without ever seeing an org-creation step. Reuses the same organization on
  // repeat use rather than spawning a new one every time — scoped per
  // country, since a personal org's country/payment provider is fixed once
  // created (same rule as a regular organization): quick-collecting for
  // Uganda after already having a Kenya personal org creates a second one,
  // it never silently reuses the wrong-country org.
  async getOrCreatePersonalOrg(
    userId: string,
    userName: string,
    country: OrganizationCountry = OrganizationCountry.KENYA,
  ) {
    const existing = await this.prisma.organizationMembership.findFirst({
      where: { userId, organization: { isPersonal: true, country } },
      select: { organization: true },
    });
    if (existing) return existing.organization;

    const organization = await this.prisma.organization.create({
      data: {
        name:
          country === OrganizationCountry.UGANDA
            ? `${userName}'s Workspace (Uganda)`
            : `${userName}'s Workspace`,
        type: OrganizationType.OTHER,
        country,
        isPersonal: true,
        memberships: {
          create: { userId, role: OrgRole.MAIN_ORGANIZER },
        },
      },
    });

    await this.audit.record({
      userId,
      action: 'ORGANIZATION_CREATED',
      payload: {
        organizationId: organization.id,
        name: organization.name,
        isPersonal: true,
      },
    });

    return organization;
  }

  async setPayout(userId: string, organizationId: string, dto: SetPayoutDto) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    const details = await this.payouts.onboard({
      businessName: organization.name,
      bankCode: dto.bankCode,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
    });

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: details,
    });

    await this.audit.record({
      userId,
      action: 'ORGANIZATION_PAYOUT_SET',
      payload: { organizationId, bankName: dto.bankName },
    });

    return maskPhone(updated);
  }

  // Uganda/PawaPay orgs only — there's no bank-style resolve/subaccount step
  // to call out to, so this is pure local validation + storage.
  async setMobileMoneyPayout(
    userId: string,
    organizationId: string,
    dto: SetMobileMoneyPayoutDto,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { country: true },
    });
    if (organization.country !== OrganizationCountry.UGANDA) {
      throw new ForbiddenException(
        'Mobile money payouts are only available for Uganda organizations',
      );
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        payoutMobileProvider: dto.provider,
        payoutMobileNumber: dto.phoneNumber,
      },
    });

    await this.audit.record({
      userId,
      action: 'ORGANIZATION_MOBILE_MONEY_PAYOUT_SET',
      payload: { organizationId, provider: dto.provider },
    });

    return maskPhone(updated);
  }

  findOne(organizationId: string) {
    return this.prisma.organization
      .findUniqueOrThrow({ where: { id: organizationId } })
      .then(maskPhone);
  }

  // Self-scoped (not org-scoped) — how a freshly logged-in user discovers
  // which organizations they belong to, and with what role, without
  // already knowing an organization's id.
  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...maskPhone(membership.organization),
      role: membership.role,
    }));
  }

  listMembers(organizationId: string) {
    return this.prisma.organizationMembership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async inviteMember(
    actingUserId: string,
    organizationId: string,
    dto: InviteMemberDto,
  ) {
    const invitedUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!invitedUser) {
      return this.createInvitation(actingUserId, organizationId, dto);
    }

    const existingMembership =
      await this.prisma.organizationMembership.findUnique({
        where: {
          userId_organizationId: { userId: invitedUser.id, organizationId },
        },
      });
    if (existingMembership) {
      throw new ForbiddenException(
        'This user is already a member of the organization',
      );
    }

    const membership = await this.prisma.organizationMembership.create({
      data: { userId: invitedUser.id, organizationId, role: dto.role },
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'ORGANIZATION_MEMBER_INVITED',
      payload: {
        organizationId,
        invitedUserId: invitedUser.id,
        role: dto.role,
      },
    });

    return membership;
  }

  // No account exists yet for this email — persist a pending invitation and
  // email a sign-up link instead. Resolved into a real OrganizationMembership
  // by AuthService.register() if the invited email registers with the token.
  private async createInvitation(
    actingUserId: string,
    organizationId: string,
    dto: InviteMemberDto,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.organizationInvitation.create({
      data: {
        organizationId,
        email: dto.email,
        role: dto.role,
        invitedByUserId: actingUserId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
      },
    });

    const baseUrl = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');
    await this.email.send({
      to: dto.email,
      subject: `You're invited to join ${organization.name} on OpenPool`,
      html: `<p>You've been invited to join <strong>${organization.name}</strong> as
        ${dto.role}. Create an account to accept (this link expires in 7 days):</p>
        <p><a href="${baseUrl}/register?invite=${rawToken}">Accept invitation</a></p>`,
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'ORGANIZATION_INVITATION_SENT',
      payload: { organizationId, invitedEmail: dto.email, role: dto.role },
    });

    return { status: 'invited' as const, email: dto.email, role: dto.role };
  }

  async getInvitationPreview(rawToken: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { organization: { select: { name: true } } },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== OrganizationInvitationStatus.PENDING) {
      throw new GoneException('This invitation is no longer valid');
    }
    if (invitation.expiresAt < new Date()) {
      throw new GoneException('This invitation has expired');
    }

    return {
      organizationName: invitation.organization.name,
      role: invitation.role,
      email: invitation.email,
    };
  }
}
