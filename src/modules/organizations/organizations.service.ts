import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import { OrgRole } from '../../../generated/prisma/enums';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payouts: PayoutsService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const organization = await this.prisma.organization.create({
      data: {
        name: dto.name,
        type: dto.type,
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

    return updated;
  }

  findOne(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
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
      ...membership.organization,
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
      throw new NotFoundException(
        'No account found for this email. The user must register before being added to an organization.',
      );
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
}
