import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  OrganizationCountry,
  PersonalInvoiceStatus,
} from '../../../generated/prisma/enums';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import {
  MOBILE_MONEY_PROVIDERS,
  type MobileMoneyProvider,
} from '../payments/providers/payment-provider.interface';
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
      },
    });

    await this.audit.record({
      userId,
      action: 'PERSONAL_INVOICE_CREATED',
      payload: { personalInvoiceId: invoice.id },
    });

    return invoice;
  }

  listForUser(userId: string) {
    return this.prisma.personalInvoice.findMany({
      where: { issuerId: userId },
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
      return this.prisma.personalInvoice.update({
        where: { id: invoice.id },
        data: { status: PersonalInvoiceStatus.EXPIRED },
        include: PUBLIC_INCLUDE,
      });
    }

    return invoice;
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

    if (invoice.issuer.country === OrganizationCountry.UGANDA) {
      if (!dto.phoneNumber || !isMobileMoneyProvider(dto.paymentMethod)) {
        throw new BadRequestException(
          'A phone number and network (MTN or Airtel) are required to pay this invoice',
        );
      }
      result = await provider.initializeCharge({
        email: dto.payerEmail,
        amount: Number(invoice.amount),
        reference,
        currency: 'UGX',
        metadata: { personalInvoiceId: invoice.id },
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
        amount: Number(invoice.amount),
        reference,
        subaccountCode: invoice.issuer.gatewayWalletId ?? undefined,
        metadata: { personalInvoiceId: invoice.id },
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
