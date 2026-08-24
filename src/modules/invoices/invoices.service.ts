import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { InvoiceStatus } from '../../../generated/prisma/enums';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';

const DEFAULT_EXPIRY_DAYS = 30;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateInvoiceDto) {
    const isPermanent = dto.isPermanent ?? false;
    const expiresAt = isPermanent
      ? null
      : new Date(
          Date.now() +
            (dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
        );

    const invoice = await this.prisma.invoice.create({
      data: {
        eventId: dto.eventId,
        contributorName: dto.contributorName,
        contributorEmail: dto.contributorEmail,
        amountRequested: dto.amountRequested,
        categoryTag: dto.categoryTag,
        secureToken: randomBytes(32).toString('hex'),
        expiresAt,
      },
    });

    await this.audit.record({
      userId,
      eventId: invoice.eventId,
      action: isPermanent ? 'PERMANENT_LINK_CREATED' : 'INVOICE_CREATED',
      payload: { invoiceId: invoice.id },
    });

    return invoice;
  }

  findOne(invoiceId: string) {
    return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  }

  listForEvent(eventId: string) {
    return this.prisma.invoice.findMany({ where: { eventId } });
  }

  async findByToken(secureToken: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { secureToken },
      include: {
        event: { select: { id: true, title: true, isPermanent: true } },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (
      invoice.expiresAt &&
      invoice.expiresAt < new Date() &&
      invoice.status === InvoiceStatus.PENDING
    ) {
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.EXPIRED },
        include: {
          event: { select: { id: true, title: true, isPermanent: true } },
        },
      });
    }

    return invoice;
  }
}
