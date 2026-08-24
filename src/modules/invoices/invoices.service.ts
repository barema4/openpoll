import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { InvoiceStatus } from '../../../generated/prisma/enums';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';

const DEFAULT_EXPIRY_DAYS = 30;

const INVOICE_PUBLIC_INCLUDE = {
  event: { select: { id: true, title: true, isPermanent: true } },
} as const;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateInvoiceDto) {
    const isPermanent = dto.isPermanent ?? false;

    // Single-use invoices track partial payments against a fixed target, so
    // they need a target amount to know when they've been fully paid.
    // Permanent links are uncapped — the contributor picks an amount each time.
    if (!isPermanent && !dto.amountRequested) {
      throw new BadRequestException(
        'amountRequested is required for single-use invoices (omit it, or set isPermanent, for an open-ended link)',
      );
    }

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
      include: INVOICE_PUBLIC_INCLUDE,
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const isOpen =
      invoice.status === InvoiceStatus.PENDING ||
      invoice.status === InvoiceStatus.PARTIALLY_PAID;
    if (invoice.expiresAt && invoice.expiresAt < new Date() && isOpen) {
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.EXPIRED },
        include: INVOICE_PUBLIC_INCLUDE,
      });
    }

    return invoice;
  }
}
