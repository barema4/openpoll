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
}
