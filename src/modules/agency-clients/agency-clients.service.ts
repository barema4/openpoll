import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { OrgRole } from '../../../generated/prisma/enums';
import { DEFAULT_COUNTRY_CODE } from '../../config/supported-countries';
import { maskPhone } from '../payouts/mask-phone.util';
import type { CreateClientOrgDto } from './dto/create-client-org.dto';
import type { GrantClientAccessDto } from './dto/grant-client-access.dto';

@Injectable()
export class AgencyClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Creates a normal Organization (nothing about it is a "shell" — it can
  // gain its own direct members via the regular invite flow at any time),
  // links it to the agency, and grants the creator MAIN_ORGANIZER access to
  // it — otherwise the very org they just created would be inaccessible to
  // them, since AgencyClientLink alone grants no individual access.
  async createClient(
    agencyOrganizationId: string,
    userId: string,
    dto: CreateClientOrgDto,
  ) {
    await this.assertCanLinkAnotherClient(agencyOrganizationId);

    const clientOrganization = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          type: dto.type,
          country: dto.country ?? DEFAULT_COUNTRY_CODE,
        },
      });
      await tx.agencyClientLink.create({
        data: {
          agencyOrganizationId,
          clientOrganizationId: organization.id,
        },
      });
      await tx.agencyClientAccess.create({
        data: {
          agencyOrganizationId,
          clientOrganizationId: organization.id,
          userId,
          role: OrgRole.MAIN_ORGANIZER,
          grantedByUserId: userId,
        },
      });
      return organization;
    });

    await this.audit.record({
      userId,
      action: 'AGENCY_CLIENT_CREATED',
      payload: {
        agencyOrganizationId,
        clientOrganizationId: clientOrganization.id,
        name: clientOrganization.name,
      },
    });

    return maskPhone(clientOrganization);
  }

  // The first linked client is free — only the 2nd+ requires an active
  // Agency plan (see BillingModule/Organization.agencyPlanExpiresAt).
  // Already-linked clients keep working in full even if the plan lapses;
  // this only blocks *adding another one*.
  private async assertCanLinkAnotherClient(agencyOrganizationId: string) {
    const existingClientCount = await this.prisma.agencyClientLink.count({
      where: { agencyOrganizationId },
    });
    if (existingClientCount === 0) return;

    const agency = await this.prisma.organization.findUniqueOrThrow({
      where: { id: agencyOrganizationId },
      select: { agencyPlanExpiresAt: true },
    });
    const hasActivePlan =
      agency.agencyPlanExpiresAt !== null &&
      agency.agencyPlanExpiresAt > new Date();
    if (!hasActivePlan) {
      throw new ForbiddenException(
        'Upgrade to the Agency plan to manage more than one client',
      );
    }
  }

  async listClients(agencyOrganizationId: string) {
    const links = await this.prisma.agencyClientLink.findMany({
      where: { agencyOrganizationId },
      include: { clientOrganization: true },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => maskPhone(link.clientOrganization));
  }

  private async assertLinked(
    agencyOrganizationId: string,
    clientOrganizationId: string,
  ) {
    const link = await this.prisma.agencyClientLink.findUnique({
      where: { clientOrganizationId },
    });
    if (!link || link.agencyOrganizationId !== agencyOrganizationId) {
      throw new NotFoundException('This client is not managed by this agency');
    }
  }

  async grantAccess(
    agencyOrganizationId: string,
    clientOrganizationId: string,
    granterUserId: string,
    dto: GrantClientAccessDto,
  ) {
    await this.assertLinked(agencyOrganizationId, clientOrganizationId);

    // Must already be agency staff before being grantable per-client access
    // — the agency's own staff roster (OrganizationMembership) is the pool
    // an admin picks from, matching the invite-flow validation style used
    // for direct org membership.
    const staffMembership = await this.prisma.organizationMembership.findUnique(
      {
        where: {
          userId_organizationId: {
            userId: dto.userId,
            organizationId: agencyOrganizationId,
          },
        },
      },
    );
    if (!staffMembership) {
      throw new BadRequestException(
        'This user must be a member of the agency before being granted client access',
      );
    }

    const access = await this.prisma.agencyClientAccess.upsert({
      where: {
        userId_clientOrganizationId: {
          userId: dto.userId,
          clientOrganizationId,
        },
      },
      create: {
        agencyOrganizationId,
        clientOrganizationId,
        userId: dto.userId,
        role: dto.role,
        grantedByUserId: granterUserId,
      },
      update: { role: dto.role, grantedByUserId: granterUserId },
    });

    await this.audit.record({
      userId: granterUserId,
      action: 'AGENCY_CLIENT_ACCESS_GRANTED',
      payload: {
        agencyOrganizationId,
        clientOrganizationId,
        grantedToUserId: dto.userId,
        role: dto.role,
      },
    });

    return access;
  }

  async revokeAccess(
    agencyOrganizationId: string,
    clientOrganizationId: string,
    targetUserId: string,
    actingUserId: string,
  ) {
    await this.assertLinked(agencyOrganizationId, clientOrganizationId);

    await this.prisma.agencyClientAccess.deleteMany({
      where: { userId: targetUserId, clientOrganizationId },
    });

    await this.audit.record({
      userId: actingUserId,
      action: 'AGENCY_CLIENT_ACCESS_REVOKED',
      payload: {
        agencyOrganizationId,
        clientOrganizationId,
        revokedUserId: targetUserId,
      },
    });
  }

  async listAccessForClient(
    agencyOrganizationId: string,
    clientOrganizationId: string,
  ) {
    await this.assertLinked(agencyOrganizationId, clientOrganizationId);

    return this.prisma.agencyClientAccess.findMany({
      where: { agencyOrganizationId, clientOrganizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
