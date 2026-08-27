import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import type { CreateEventDto } from './dto/create-event.dto';
import type { UpdateEventDto } from './dto/update-event.dto';
import type { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import type { EventStatus } from '../../../generated/prisma/enums';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payouts: PayoutsService,
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

  async setPayout(userId: string, eventId: string, dto: SetPayoutDto) {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { title: true },
    });

    const details = await this.payouts.onboard({
      businessName: event.title,
      bankCode: dto.bankCode,
      bankName: dto.bankName,
      accountNumber: dto.accountNumber,
    });

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: details,
    });

    await this.audit.record({
      userId,
      eventId,
      action: 'EVENT_PAYOUT_SET',
      payload: { bankName: dto.bankName },
    });

    return updated;
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
