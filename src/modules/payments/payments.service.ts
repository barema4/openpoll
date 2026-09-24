import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { Prisma } from '../../../generated/prisma/client';
import { InvoiceStatus } from '../../../generated/prisma/enums';
import {
  DEFAULT_COUNTRY_CODE,
  getSupportedCountry,
} from '../../config/supported-countries';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { isMobileMoneyProviderForCountry } from './providers/payment-provider.interface';
import { calculatePlatformFee } from './platform-fee.util';
import type { InitiateCheckoutDto } from './dto/initiate-checkout.dto';
import type { InitiateDepositDto } from './dto/initiate-deposit.dto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async initializeCheckout(token: string, dto: InitiateCheckoutDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { secureToken: token },
      include: { event: { include: { organization: true } } },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const isSingleUse = invoice.expiresAt !== null;

    if (isSingleUse && invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(
        'This invoice has already been paid in full',
      );
    }
    if (isSingleUse && invoice.expiresAt! < new Date()) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.EXPIRED },
      });
      throw new BadRequestException('This invoice has expired');
    }

    // A single-use link with no fixed amountRequested is an open-amount link
    // (e.g. a pledge that never fixed a number) — resolve it the same way as
    // a permanent link: the payer decides, no remaining-balance cap.
    const amount =
      isSingleUse && invoice.amountRequested !== null
        ? this.resolveSingleUseChargeAmount(invoice, dto)
        : this.resolvePermanentLinkChargeAmount(dto, invoice.amountRequested);

    await this.captureContributorIdentity(invoice, dto);

    const reference = randomUUID();
    const countryCode =
      invoice.event.organization?.country ?? DEFAULT_COUNTRY_CODE;
    const { chargeShape, currency } = getSupportedCountry(countryCode);
    const provider = this.providers.forCountry(countryCode);

    const checkoutBaseUrl = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');

    // Charged additively on top of what the payer intends to give — the
    // event is still credited exactly `amount`, never `amount + fee`. See
    // WebhookProcessor, which subtracts this back out before crediting.
    const platformFeePercent =
      this.config.get<number>('PLATFORM_FEE_PERCENT') ?? 0;
    const platformFeeAmount = calculatePlatformFee(amount, platformFeePercent);
    const grossAmount = amount + platformFeeAmount;
    const metadata = {
      invoiceId: invoice.id,
      eventId: invoice.eventId,
      platformFeeAmount,
    };

    if (chargeShape === 'MOBILE_MONEY_PUSH') {
      if (
        !dto.phoneNumber ||
        !isMobileMoneyProviderForCountry(countryCode, dto.paymentMethod)
      ) {
        throw new BadRequestException(
          'A phone number and a supported mobile money network are required to pay this event',
        );
      }
      return provider.initializeCharge({
        email: dto.email,
        amount: grossAmount,
        reference,
        currency,
        metadata,
        mobileMoney: {
          phoneNumber: dto.phoneNumber,
          provider: dto.paymentMethod,
        },
      });
    }

    const subaccountCode =
      invoice.event.gatewayWalletId ??
      invoice.event.organization?.gatewayWalletId;

    return provider.initializeCharge({
      email: dto.email,
      amount: grossAmount,
      reference,
      currency,
      subaccountCode: subaccountCode ?? undefined,
      platformFeeAmount,
      metadata,
      callbackUrl: `${checkoutBaseUrl}/receipt`,
      channels:
        dto.paymentMethod &&
        !isMobileMoneyProviderForCountry(countryCode, dto.paymentMethod)
          ? [dto.paymentMethod]
          : undefined,
    });
  }

  // An organization member funding their own event directly — e.g. topping
  // up the budget-allocatable pool from their own mobile money, distinct
  // from a public contribution. No Invoice involved (metadata carries
  // eventId directly, which WebhookProcessor already supports) and no
  // platform fee added on top (unlike initializeCheckout's grossAmount) —
  // this isn't a contribution the platform takes a cut of.
  async initiateDeposit(
    user: AuthenticatedUser,
    eventId: string,
    dto: InitiateDepositDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organization: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const reference = randomUUID();
    const countryCode = event.organization?.country ?? DEFAULT_COUNTRY_CODE;
    const { chargeShape, currency } = getSupportedCountry(countryCode);
    const provider = this.providers.forCountry(countryCode);
    const metadata = { eventId, platformFeeAmount: 0 };

    if (chargeShape === 'MOBILE_MONEY_PUSH') {
      if (
        !dto.phoneNumber ||
        !isMobileMoneyProviderForCountry(countryCode, dto.paymentMethod)
      ) {
        throw new BadRequestException(
          'A phone number and a supported mobile money network are required to deposit into this event',
        );
      }
      const result = await provider.initializeCharge({
        email: user.email,
        amount: dto.amount,
        reference,
        currency,
        metadata,
        mobileMoney: {
          phoneNumber: dto.phoneNumber,
          provider: dto.paymentMethod,
        },
      });
      await this.audit.record({
        userId: user.id,
        eventId,
        action: 'EVENT_DEPOSIT_INITIATED',
        payload: { amount: dto.amount, reference },
      });
      return result;
    }

    const checkoutBaseUrl = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');
    const subaccountCode =
      event.gatewayWalletId ?? event.organization?.gatewayWalletId;

    const result = await provider.initializeCharge({
      email: user.email,
      amount: dto.amount,
      reference,
      currency,
      subaccountCode: subaccountCode ?? undefined,
      metadata,
      callbackUrl: `${checkoutBaseUrl}/receipt`,
      channels:
        dto.paymentMethod &&
        !isMobileMoneyProviderForCountry(countryCode, dto.paymentMethod)
          ? [dto.paymentMethod]
          : undefined,
    });
    await this.audit.record({
      userId: user.id,
      eventId,
      action: 'EVENT_DEPOSIT_INITIATED',
      payload: { amount: dto.amount, reference },
    });
    return result;
  }

  // Single-use invoices carry a fixed amountRequested and accept repeated
  // partial payments (multiple transactions) until that target is met — the
  // caller can either pay off the remainder in one go (omit `amount`) or pay
  // a smaller partial amount, but never more than what's left outstanding.
  private resolveSingleUseChargeAmount(
    invoice: {
      amountRequested: Prisma.Decimal | null;
      amountPaid: Prisma.Decimal;
    },
    dto: InitiateCheckoutDto,
  ): number {
    const target = Number(invoice.amountRequested);
    const alreadyPaid = Number(invoice.amountPaid);
    const remaining = target - alreadyPaid;

    const amount = dto.amount ?? remaining;
    if (amount <= 0) {
      throw new BadRequestException('This invoice has no remaining balance');
    }
    if (amount > remaining) {
      throw new BadRequestException(
        `Amount exceeds the remaining balance on this invoice (${remaining})`,
      );
    }
    return amount;
  }

  // Fills in the payer's identity on the invoice if it isn't already set —
  // never overwrites what the organizer (or an earlier payer) already put
  // there, so a shared permanent link keeps whichever name got there first.
  private async captureContributorIdentity(
    invoice: {
      id: string;
      contributorEmail: string | null;
      contributorName: string | null;
      contributorPhone: string | null;
    },
    dto: InitiateCheckoutDto,
  ) {
    const data: Prisma.InvoiceUpdateInput = {};
    if (!invoice.contributorEmail) data.contributorEmail = dto.email;
    if (!invoice.contributorName && dto.contributorName) {
      data.contributorName = dto.contributorName;
    }
    if (!invoice.contributorPhone && dto.contributorPhone) {
      data.contributorPhone = dto.contributorPhone;
    }
    if (Object.keys(data).length === 0) return;

    await this.prisma.invoice.update({ where: { id: invoice.id }, data });
  }

  // Permanent links are uncapped — every contribution is independent.
  private resolvePermanentLinkChargeAmount(
    dto: InitiateCheckoutDto,
    amountRequested: Prisma.Decimal | null,
  ): number {
    const amount = amountRequested ? Number(amountRequested) : dto.amount;
    if (!amount || amount <= 0) {
      throw new BadRequestException(
        'An amount is required for this payment link',
      );
    }
    return amount;
  }
}
