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
import {
  PlatformRole,
  PlatformStaffInvitationStatus,
} from '../../../generated/prisma/enums';
import type { InviteStaffDto } from './dto/invite-staff.dto';

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  listStaff() {
    return this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async inviteStaff(actingUserId: string, dto: InviteStaffDto) {
    const invitedUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!invitedUser) {
      return this.createInvitation(actingUserId, dto);
    }

    if (invitedUser.platformRole) {
      throw new ForbiddenException('This user already has platform access');
    }

    const updated = await this.prisma.user.update({
      where: { id: invitedUser.id },
      data: { platformRole: PlatformRole.STAFF },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'PLATFORM_STAFF_GRANTED',
      payload: { grantedUserId: invitedUser.id, email: invitedUser.email },
    });

    return updated;
  }

  // No account exists yet for this email — persist a pending invitation and
  // email a sign-up link instead. Resolved into platformRole: STAFF by
  // AuthService.register() if the invited email registers with the token.
  private async createInvitation(actingUserId: string, dto: InviteStaffDto) {
    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.platformStaffInvitation.create({
      data: {
        email: dto.email,
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
      subject: "You're invited to join the OpenPool team",
      html: `<p>You've been invited to join the OpenPool operations team. Create an
        account to accept (this link expires in 7 days):</p>
        <p><a href="${baseUrl}/register?staffInvite=${rawToken}">Accept invitation</a></p>`,
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'PLATFORM_STAFF_INVITATION_SENT',
      payload: { invitedEmail: dto.email },
    });

    return { status: 'invited' as const, email: dto.email };
  }

  async revokeStaff(actingUserId: string, targetUserId: string) {
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { platformRole: null },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'PLATFORM_STAFF_REVOKED',
      payload: { revokedUserId: targetUserId },
    });

    return updated;
  }

  // No self-serve billing exists for the Agency plan (Stripe billing was
  // removed) — a platform staff member flips this on manually for a paying
  // agency instead. See AgencyClientsService.assertCanLinkAnotherClient,
  // the sole consumer of this flag.
  async setAgencyPlan(
    actingUserId: string,
    organizationId: string,
    hasAgencyPlan: boolean,
  ) {
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { hasAgencyPlan },
      select: { id: true, name: true, hasAgencyPlan: true },
    });

    await this.audit.record({
      userId: actingUserId,
      action: hasAgencyPlan ? 'AGENCY_PLAN_GRANTED' : 'AGENCY_PLAN_REVOKED',
      payload: { organizationId },
    });

    return updated;
  }

  async getInvitationPreview(rawToken: string) {
    const invitation = await this.prisma.platformStaffInvitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== PlatformStaffInvitationStatus.PENDING) {
      throw new GoneException('This invitation is no longer valid');
    }
    if (invitation.expiresAt < new Date()) {
      throw new GoneException('This invitation has expired');
    }

    return { email: invitation.email };
  }
}
