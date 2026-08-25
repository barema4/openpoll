import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { InvoiceSource, InvoiceStatus } from '../../../generated/prisma/enums';
import { formatContributorSummaryText } from './contributor-summary.util';
import type {
  ContributorBuckets,
  ContributorEntry,
} from './contributor-summary.util';
import { buildInvoiceShareLinks } from './share-links.util';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { CreatePledgeDto } from './dto/create-pledge.dto';

const DEFAULT_EXPIRY_DAYS = 30;

const INVOICE_PUBLIC_INCLUDE = {
  event: { select: { id: true, title: true, isPermanent: true } },
} as const;

interface PersistInvoiceParams {
  eventId: string;
  contributorName?: string;
  contributorEmail?: string;
  contributorPhone?: string;
  amountRequested?: number;
  categoryTag?: string;
  isPermanent: boolean;
  expiresInDays?: number;
  source: InvoiceSource;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, dto: CreateInvoiceDto) {
    const isPermanent = dto.isPermanent ?? false;
    const invoice = await this.persistInvoice({
      ...dto,
      isPermanent,
      source: InvoiceSource.ORGANIZER,
    });

    await this.audit.record({
      userId,
      eventId: invoice.eventId,
      action: isPermanent ? 'PERMANENT_LINK_CREATED' : 'INVOICE_CREATED',
      payload: { invoiceId: invoice.id },
    });

    return invoice;
  }

  // Public self-service pledge: a contributor commits an amount for an event
  // without paying immediately. Structurally identical to a single-use
  // invoice — see the Invoice partial-payment state machine in webhook.processor.ts.
  async createPledge(eventId: string, dto: CreatePledgeDto) {
    const invoice = await this.persistInvoice({
      eventId,
      contributorName: dto.contributorName,
      contributorPhone: dto.contributorPhone,
      amountRequested: dto.amountPledged,
      categoryTag: dto.categoryTag,
      isPermanent: false,
      source: InvoiceSource.PUBLIC_PLEDGE,
    });

    await this.audit.record({
      userId: null,
      eventId: invoice.eventId,
      action: 'CONTRIBUTOR_PLEDGE_CREATED',
      payload: { invoiceId: invoice.id },
    });

    return invoice;
  }

  findOne(invoiceId: string) {
    return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  }

  // Pre-filled wa.me / mailto: links the organizer clicks to share this
  // invoice's payment link themselves — no automated sending, no third-party
  // account needed (see the WhatsApp-group-summary feature for why).
  async getShareLinks(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { event: { select: { title: true } } },
    });

    return buildInvoiceShareLinks({
      checkoutBaseUrl: this.config.get<string>('PUBLIC_CHECKOUT_BASE_URL')!,
      secureToken: invoice.secureToken,
      contributorName: invoice.contributorName,
      contributorPhone: invoice.contributorPhone,
      contributorEmail: invoice.contributorEmail,
      eventTitle: invoice.event.title,
      amountRequested: invoice.amountRequested
        ? Number(invoice.amountRequested)
        : null,
    });
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

  // Buckets single-use invoices (pledges) for an event by payment status.
  // Permanent links are excluded — they're ongoing collections, not
  // per-person pledges. `includePhone: false` redacts contributorPhone for
  // the public/unauthenticated summary route.
  async getContributorSummary(
    eventId: string,
    options: { includePhone: boolean },
  ) {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { title: true },
    });

    const invoices = await this.prisma.invoice.findMany({
      where: { eventId, expiresAt: { not: null } },
      orderBy: { createdAt: 'asc' },
    });

    const buckets: ContributorBuckets = {
      pledged: [],
      partiallyPaid: [],
      fullyPaid: [],
      expired: [],
    };
    let totalPledged = 0;
    let totalReceived = 0;

    for (const invoice of invoices) {
      const amountRequested = Number(invoice.amountRequested ?? 0);
      const amountPaid = Number(invoice.amountPaid);
      totalPledged += amountRequested;
      totalReceived += amountPaid;

      const entry: ContributorEntry = {
        invoiceId: invoice.id,
        contributorName: invoice.contributorName,
        amountRequested,
        amountPaid,
        remaining: Math.max(amountRequested - amountPaid, 0),
        source: invoice.source,
      };
      if (options.includePhone) {
        entry.contributorPhone = invoice.contributorPhone;
      }

      switch (invoice.status) {
        case InvoiceStatus.PENDING:
          buckets.pledged.push(entry);
          break;
        case InvoiceStatus.PARTIALLY_PAID:
          buckets.partiallyPaid.push(entry);
          break;
        case InvoiceStatus.PAID:
          buckets.fullyPaid.push(entry);
          break;
        case InvoiceStatus.EXPIRED:
          buckets.expired.push(entry);
          break;
      }
    }

    const totals = { pledged: totalPledged, received: totalReceived };
    const text = formatContributorSummaryText(event.title, buckets, totals);

    return { buckets, totals, text };
  }

  private async persistInvoice(params: PersistInvoiceParams) {
    if (!params.isPermanent && !params.amountRequested) {
      throw new BadRequestException(
        'amountRequested is required for single-use invoices (omit it, or set isPermanent, for an open-ended link)',
      );
    }

    const expiresAt = params.isPermanent
      ? null
      : new Date(
          Date.now() +
            (params.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
        );

    return this.prisma.invoice.create({
      data: {
        eventId: params.eventId,
        contributorName: params.contributorName,
        contributorEmail: params.contributorEmail,
        contributorPhone: params.contributorPhone,
        amountRequested: params.amountRequested,
        categoryTag: params.categoryTag,
        source: params.source,
        secureToken: randomBytes(32).toString('hex'),
        expiresAt,
      },
    });
  }
}
