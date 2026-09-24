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
import { PersonalInvoiceStatus } from '../../../generated/prisma/enums';
import { getSupportedCountry } from '../../config/supported-countries';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import {
  isMobileMoneyProviderForCountry,
  MOBILE_MONEY_PROVIDERS_BY_COUNTRY,
} from '../payments/providers/payment-provider.interface';
import { calculatePlatformFee } from '../payments/platform-fee.util';
import { buildPersonalInvoiceShareLinks } from './share-links.util';
import type { CreatePersonalInvoiceDto } from './dto/create-personal-invoice.dto';
import type { InitiatePersonalInvoiceCheckoutDto } from './dto/initiate-personal-invoice-checkout.dto';

const DEFAULT_EXPIRY_DAYS = 30;

const PUBLIC_INCLUDE = {
  issuer: { select: { id: true, name: true, country: true } },
} as const;

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

    const issuer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { country: true },
    });

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
        currency: getSupportedCountry(issuer.country).currency,
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
      return this.withMobileMoneyInfo(this.withFeeBreakdown(expired));
    }

    return this.withMobileMoneyInfo(this.withFeeBreakdown(invoice));
  }

  // Tells the pay page which chargeShape the issuer's country uses and,
  // for MOBILE_MONEY_PUSH, which operators to offer — mirrors
  // InvoicesService.withMobileMoneyInfo for the equivalent event-invoice
  // pay page.
  private withMobileMoneyInfo<T extends { issuer: { country: string } }>(
    invoice: T,
  ): T & {
    chargeShape: ReturnType<typeof getSupportedCountry>['chargeShape'];
    mobileMoneyOperators: (typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY)[keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY];
  } {
    const { chargeShape } = getSupportedCountry(invoice.issuer.country);
    const mobileMoneyOperators =
      MOBILE_MONEY_PROVIDERS_BY_COUNTRY[
        invoice.issuer.country as keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY
      ] ?? [];
    return { ...invoice, chargeShape, mobileMoneyOperators };
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
    const { chargeShape, currency } = getSupportedCountry(
      invoice.issuer.country,
    );
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

    if (chargeShape === 'MOBILE_MONEY_PUSH') {
      if (
        !dto.phoneNumber ||
        !isMobileMoneyProviderForCountry(
          invoice.issuer.country,
          dto.paymentMethod,
        )
      ) {
        throw new BadRequestException(
          'A phone number and a supported mobile money network are required to pay this invoice',
        );
      }
      result = await provider.initializeCharge({
        email: dto.payerEmail,
        amount: grossAmount,
        reference,
        currency,
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
        currency,
        subaccountCode: invoice.issuer.gatewayWalletId ?? undefined,
        platformFeeAmount,
        metadata,
        callbackUrl: `${checkoutBaseUrl}/i/${token}`,
        channels:
          dto.paymentMethod &&
          !isMobileMoneyProviderForCountry(
            invoice.issuer.country,
            dto.paymentMethod,
          )
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
