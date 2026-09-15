import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { paginate } from '../common/pagination.util';

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
  async findForOrganization(organizationId: string, query: PaginationQueryDto) {
    const { page = 1, pageSize = 10 } = query;
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { event: { organizationId } },
        {
          payloadSnapshot: {
            path: ['organizationId'],
            equals: organizationId,
          },
        },
      ],
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          event: { select: { id: true, title: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }
}
