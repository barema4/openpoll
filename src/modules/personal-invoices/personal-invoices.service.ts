import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { Prisma } from '../../../generated/prisma/client';
import {
  OrganizationCountry,
  PersonalInvoiceStatus,
} from '../../../generated/prisma/enums';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import {
  MOBILE_MONEY_PROVIDERS,
  type MobileMoneyProvider,
} from '../payments/providers/payment-provider.interface';
import { calculatePlatformFee } from '../payments/platform-fee.util';
import { buildPersonalInvoiceShareLinks } from './share-links.util';
import type { CreatePersonalInvoiceDto } from './dto/create-personal-invoice.dto';
import type { InitiatePersonalInvoiceCheckoutDto } from './dto/initiate-personal-invoice-checkout.dto';

const DEFAULT_EXPIRY_DAYS = 30;

const PUBLIC_INCLUDE = {
  issuer: { select: { id: true, name: true, country: true } },
} as const;

function isMobileMoneyProvider(
  value: string | undefined,
): value is MobileMoneyProvider {
  return (MOBILE_MONEY_PROVIDERS as readonly string[]).includes(value ?? '');
}

@Injectable()
export class PersonalInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async create(userId: string, dto: CreatePersonalInvoiceDto) {
    if (dto.relatedOrganizationId) {
      await this.assertOrgAccess(userId, dto.relatedOrganizationId);
    }

    const expiresAt = new Date(
      Date.now() +
        (dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
    );

    const invoice = await this.prisma.personalInvoice.create({
      data: {
        issuerId: userId,
        recipientName: dto.recipientName,
        recipientEmail: dto.recipientEmail,
        recipientPhone: dto.recipientPhone,
        description: dto.description,
        amount: dto.amount,
        secureToken: randomBytes(32).toString('hex'),
        expiresAt,
        relatedOrganizationId: dto.relatedOrganizationId,
      },
    });

    await this.audit.record({
      userId,
      action: 'PERSONAL_INVOICE_CREATED',
      payload: {
        personalInvoiceId: invoice.id,
        relatedOrganizationId: dto.relatedOrganizationId ?? null,
      },
    });

    return invoice;
  }

  // Not org-scoped like the rest of this controller — this route has no
  // OrgRolesGuard to lean on, so access to relatedOrganizationId is checked
  // by hand: a direct membership, or an agency grant (AgencyClientAccess),
  // the same two ways OrgRolesGuard itself would allow it.
  private async assertOrgAccess(userId: string, organizationId: string) {
    const [membership, agencyAccess] = await Promise.all([
      this.prisma.organizationMembership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      }),
      this.prisma.agencyClientAccess.findUnique({
        where: {
          userId_clientOrganizationId: {
            userId,
            clientOrganizationId: organizationId,
          },
        },
      }),
    ]);
    if (!membership && !agencyAccess) {
      throw new ForbiddenException(
        "You don't have access to that organization",
      );
    }
  }

  listForUser(userId: string, relatedOrganizationId?: string) {
    return this.prisma.personalInvoice.findMany({
      where: {
        issuerId: userId,
        ...(relatedOrganizationId ? { relatedOrganizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const invoice = await this.prisma.personalInvoice.findUnique({
      where: { id },
    });
    if (!invoice || invoice.issuerId !== userId) {
      throw new NotFoundException('Personal invoice not found');
    }
    return invoice;
  }

  async getShareLinks(id: string, userId: string) {
    const invoice = await this.prisma.personalInvoice.findUnique({
      where: { id },
      include: { issuer: { select: { name: true } } },
    });
    if (!invoice || invoice.issuerId !== userId) {
      throw new NotFoundException('Personal invoice not found');
    }

    return buildPersonalInvoiceShareLinks({
      checkoutBaseUrl: this.config.get<string>('PUBLIC_CHECKOUT_BASE_URL')!,
      secureToken: invoice.secureToken,
      recipientName: invoice.recipientName,
      recipientPhone: invoice.recipientPhone,
      recipientEmail: invoice.recipientEmail,
      issuerName: invoice.issuer.name,
      description: invoice.description,
      amount: Number(invoice.amount),
    });
  }

  async findByToken(secureToken: string) {
    const invoice = await this.prisma.personalInvoice.findUnique({
      where: { secureToken },
      include: PUBLIC_INCLUDE,
    });
    if (!invoice) {
      throw new NotFoundException('Personal invoice not found');
    }

    const isOpen = invoice.status === PersonalInvoiceStatus.PENDING;
    if (invoice.expiresAt && invoice.expiresAt < new Date() && isOpen) {
      const expired = await this.prisma.personalInvoice.update({
        where: { id: invoice.id },
        data: { status: PersonalInvoiceStatus.EXPIRED },
        include: PUBLIC_INCLUDE,
      });
      return this.withFeeBreakdown(expired);
    }

    return this.withFeeBreakdown(invoice);
  }

  // Precomputed here (rather than left to the frontend) since a personal
  // invoice's amount is always fixed — no need to trust/duplicate the fee
  // formula client-side when the backend already knows the exact number.
  private withFeeBreakdown<T extends { amount: Prisma.Decimal }>(
    invoice: T,
  ): T & {
    platformFeePercent: number;
    platformFeeAmount: number;
    totalChargeAmount: number;
  } {
    const platformFeePercent =
      this.config.get<number>('PLATFORM_FEE_PERCENT') ?? 0;
    const platformFeeAmount = calculatePlatformFee(
      Number(invoice.amount),
      platformFeePercent,
    );
    return {
      ...invoice,
      platformFeePercent,
      platformFeeAmount,
      totalChargeAmount: Number(invoice.amount) + platformFeeAmount,
    };
  }

  async initializeCheckout(
    token: string,
    dto: InitiatePersonalInvoiceCheckoutDto,
  ) {
    const invoice = await this.prisma.personalInvoice.findUnique({
      where: { secureToken: token },
      include: {
        issuer: {
          select: {
            gatewayWalletId: true,
            country: true,
            payoutMobileProvider: true,
            payoutMobileNumber: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Personal invoice not found');
    }
    if (invoice.status === PersonalInvoiceStatus.PAID) {
      throw new BadRequestException('This invoice has already been paid');
    }
    if (invoice.status === PersonalInvoiceStatus.CANCELLED) {
      throw new BadRequestException('This invoice has been cancelled');
    }
    if (invoice.expiresAt && invoice.expiresAt < new Date()) {
      await this.prisma.personalInvoice.update({
        where: { id: invoice.id },
        data: { status: PersonalInvoiceStatus.EXPIRED },
      });
      throw new BadRequestException('This invoice has expired');
    }

    const reference = randomUUID();
    const provider = this.providers.forCountry(invoice.issuer.country);
    let result;

    // Charged additively on top of the invoice's amount — the issuer is
    // still credited exactly that amount, never amount + fee. See
    // PersonalInvoiceWebhookProcessor, which subtracts this back out.
    const platformFeePercent =
      this.config.get<number>('PLATFORM_FEE_PERCENT') ?? 0;
    const platformFeeAmount = calculatePlatformFee(
      Number(invoice.amount),
      platformFeePercent,
    );
    const grossAmount = Number(invoice.amount) + platformFeeAmount;
    const metadata = { personalInvoiceId: invoice.id, platformFeeAmount };

    if (invoice.issuer.country === OrganizationCountry.UGANDA) {
      if (!dto.phoneNumber || !isMobileMoneyProvider(dto.paymentMethod)) {
        throw new BadRequestException(
          'A phone number and network (MTN or Airtel) are required to pay this invoice',
        );
      }
      result = await provider.initializeCharge({
        email: dto.payerEmail,
        amount: grossAmount,
        reference,
        currency: 'UGX',
        metadata,
        mobileMoney: {
          phoneNumber: dto.phoneNumber,
          provider: dto.paymentMethod,
        },
      });
    } else {
      const checkoutBaseUrl = this.config
        .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
        .replace(/\/$/, '');

      result = await provider.initializeCharge({
        email: dto.payerEmail,
        amount: grossAmount,
        reference,
        subaccountCode: invoice.issuer.gatewayWalletId ?? undefined,
        platformFeeAmount,
        metadata,
        callbackUrl: `${checkoutBaseUrl}/i/${token}`,
        channels:
          dto.paymentMethod && !isMobileMoneyProvider(dto.paymentMethod)
            ? [dto.paymentMethod]
            : undefined,
      });
    }

    await this.audit.record({
      action: 'PERSONAL_INVOICE_CHECKOUT_INITIATED',
      payload: {
        personalInvoiceId: invoice.id,
        payerEmail: dto.payerEmail,
        payerName: dto.payerName ?? null,
        payerPhone: dto.payerPhone ?? null,
      },
    });

    return result;
  }
}
