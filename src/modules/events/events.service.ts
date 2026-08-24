import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateEventDto } from './dto/create-event.dto';
import type { UpdateEventDto } from './dto/update-event.dto';
import type { EventStatus } from '../../../generated/prisma/enums';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateEventDto) {
    const event = await this.prisma.event.create({
      data: {
        organizationId: dto.organizationId,
        title: dto.title,
        description: dto.description,
        coverImageUrl: dto.coverImageUrl,
        targetGoal: dto.targetGoal,
        isPermanent: dto.isPermanent ?? false,
        gatewayWalletId: dto.gatewayWalletId,
      },
    });

    await this.audit.record({
      userId,
      eventId: event.id,
      action: 'EVENT_CREATED',
      payload: { title: event.title, organizationId: event.organizationId },
    });

    return event;
  }

  findOne(eventId: string) {
    return this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { budgetCategories: true },
    });
  }

  listForOrganization(organizationId: string) {
    return this.prisma.event.findMany({ where: { organizationId } });
  }

  async update(userId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        title: dto.title,
        description: dto.description,
        coverImageUrl: dto.coverImageUrl,
        targetGoal: dto.targetGoal,
        gatewayWalletId: dto.gatewayWalletId,
      },
    });

    await this.audit.record({
      userId,
      eventId: event.id,
      action: 'EVENT_UPDATED',
      payload: { ...dto },
    });

    return event;
  }

  async updateStatus(userId: string, eventId: string, status: EventStatus) {
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status },
    });

    await this.audit.record({
      userId,
      eventId: event.id,
      action: 'EVENT_STATUS_UPDATED',
      payload: { status },
    });

    return event;
  }
}
