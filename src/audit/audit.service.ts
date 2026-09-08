import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(params: {
    userId?: string | null;
    eventId?: string | null;
    action: string;
    payload?: Prisma.InputJsonValue;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        eventId: params.eventId ?? null,
        action: params.action,
        payloadSnapshot: params.payload ?? undefined,
      },
    });
  }

  // Org-scoped actions (invite/payout on the Organization itself) only carry
  // `organizationId` inside the JSON payload, never `eventId` — event-scoped
  // actions carry `eventId`, which resolves to the org via Event.organizationId.
  // This covers both shapes.
  findForOrganization(organizationId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        OR: [
          { event: { organizationId } },
          {
            payloadSnapshot: {
              path: ['organizationId'],
              equals: organizationId,
            },
          },
        ],
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        event: { select: { id: true, title: true } },
      },
      orderBy: { timestamp: 'desc' },
    });
  }
}
