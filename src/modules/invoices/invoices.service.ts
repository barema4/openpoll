import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { Prisma } from '../../../generated/prisma/client';
import { InvoiceSource, InvoiceStatus } from '../../../generated/prisma/enums';
import { formatContributorSummaryText } from './contributor-summary.util';
import type {
  ContributorBuckets,
  ContributorEntry,
} from './contributor-summary.util';
import { buildInvoiceShareLinks } from './share-links.util';
import { calculatePlatformFee } from '../payments/platform-fee.util';
import {
  DEFAULT_COUNTRY_CODE,
  getSupportedCountry,
} from '../../config/supported-countries';
import { MOBILE_MONEY_PROVIDERS_BY_COUNTRY } from '../payments/providers/payment-provider.interface';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { CreatePledgeDto } from './dto/create-pledge.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { paginate } from '../../common/pagination.util';
import { dayAfter } from '../../common/date-range.util';

const DEFAULT_EXPIRY_DAYS = 30;

const INVOICE_PUBLIC_INCLUDE = {
  event: {
    select: {
      id: true,
      title: true,
      isPermanent: true,
      organization: { select: { country: true, logoUrl: true } },
    },
  },
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
      include: {
        event: {
          select: {
            title: true,
            organization: { select: { name: true, isPersonal: true } },
          },
        },
      },
    });

    // A "Quick collection" event's auto-provisioned personal org isn't a
    // real organization a contributor would recognize — only name real ones.
    const organizationName =
      invoice.event.organization && !invoice.event.organization.isPersonal
        ? invoice.event.organization.name
        : null;

    return buildInvoiceShareLinks({
      checkoutBaseUrl: this.config.get<string>('PUBLIC_CHECKOUT_BASE_URL')!,
      secureToken: invoice.secureToken,
      contributorName: invoice.contributorName,
      contributorPhone: invoice.contributorPhone,
      contributorEmail: invoice.contributorEmail,
      eventTitle: invoice.event.title,
      organizationName,
      amountRequested: invoice.amountRequested
        ? Number(invoice.amountRequested)
        : null,
    });
  }

  // The one auto-created, non-expiring link every event gets on creation
  // (see EventsService#create) — always the earliest permanent invoice.
  // Surfaced separately from the paginated list below so the "your
  // shareable link" card stays visible regardless of search/filter/page.
  getPrimaryLink(eventId: string) {
    return this.prisma.invoice.findFirst({
      where: { eventId, expiresAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listForEvent(query: ListInvoicesQueryDto) {
    const {
      eventId,
      page = 1,
      pageSize = 10,
      search,
      status,
      source,
      dateFrom,
      dateTo,
    } = query;
    const primary = await this.getPrimaryLink(eventId);
    const where: Prisma.InvoiceWhereInput = {
      eventId,
      ...(primary && { id: { not: primary.id } }),
      ...(status && { status }),
      ...(source && { source }),
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lt: dayAfter(dateTo) }),
        },
      }),
      ...(search && {
        OR: [
          { contributorName: { contains: search, mode: 'insensitive' } },
          { contributorEmail: { contains: search, mode: 'insensitive' } },
          { contributorPhone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
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
      const expired = await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.EXPIRED },
        include: INVOICE_PUBLIC_INCLUDE,
      });
      return this.withMobileMoneyInfo(this.withFeeBreakdown(expired));
    }

    return this.withMobileMoneyInfo(this.withFeeBreakdown(invoice));
  }

  // Tells the pay page which chargeShape this invoice's country uses and,
  // for MOBILE_MONEY_PUSH, which operators to offer — so it can render the
  // right network buttons for any PawaPay-backed country instead of a
  // hardcoded Uganda MTN/Airtel toggle.
  private withMobileMoneyInfo<
    T extends { event: { organization: { country: string } | null } },
  >(
    invoice: T,
  ): T & {
    chargeShape: ReturnType<typeof getSupportedCountry>['chargeShape'];
    mobileMoneyOperators: (typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY)[keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY];
  } {
    const countryCode =
      invoice.event.organization?.country ?? DEFAULT_COUNTRY_CODE;
    const { chargeShape } = getSupportedCountry(countryCode);
    const mobileMoneyOperators =
      MOBILE_MONEY_PROVIDERS_BY_COUNTRY[
        countryCode as keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY
      ] ?? [];
    return { ...invoice, chargeShape, mobileMoneyOperators };
  }

  // A permanent/open-amount link has no fixed amountRequested, so the
  // frontend computes a live preview itself off platformFeePercent as the
  // payer types. A fixed-amount invoice gets the fee precomputed here
  // instead — on the remaining balance, not the original ask, so a
  // partially-paid invoice shows the fee on what's actually still owed.
  private withFeeBreakdown<
    T extends {
      amountRequested: Prisma.Decimal | null;
      amountPaid: Prisma.Decimal;
    },
  >(
    invoice: T,
  ): T & {
    platformFeePercent: number;
    platformFeeAmount?: number;
    totalChargeAmount?: number;
  } {
    const platformFeePercent =
      this.config.get<number>('PLATFORM_FEE_PERCENT') ?? 0;
    if (invoice.amountRequested === null) {
      return { ...invoice, platformFeePercent };
    }
    const remaining = Math.max(
      Number(invoice.amountRequested) - Number(invoice.amountPaid),
      0,
    );
    const platformFeeAmount = calculatePlatformFee(
      remaining,
      platformFeePercent,
    );
    return {
      ...invoice,
      platformFeePercent,
      platformFeeAmount,
      totalChargeAmount: remaining + platformFeeAmount,
    };
  }

  // Buckets single-use invoices (pledges) for an event by payment status.
  // Permanent links are excluded — they're ongoing collections, not
  // Unauthenticated — just enough for PledgeView.vue to show the org's own
  // logo instead of the platform's badge, the same way PayView.vue already
  // does via the invoice-token lookup (PledgeView has no invoice yet, so it
  // needs this event-keyed equivalent instead).
  async getEventBranding(eventId: string) {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { organization: { select: { logoUrl: true } } },
    });
    return { logoUrl: event.organization?.logoUrl ?? null };
  }

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
    const expiresAt = params.isPermanent
      ? null
      : new Date(
          Date.now() +
            (params.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
        );
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: params.eventId },
      select: { currency: true },
    });

    return this.prisma.invoice.create({
      data: {
        eventId: params.eventId,
        contributorName: params.contributorName,
        contributorEmail: params.contributorEmail,
        contributorPhone: params.contributorPhone,
        amountRequested: params.amountRequested,
        currency: event.currency,
        categoryTag: params.categoryTag,
        source: params.source,
        secureToken: randomBytes(32).toString('hex'),
        expiresAt,
      },
    });
  }
}
