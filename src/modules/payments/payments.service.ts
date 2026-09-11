import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import {
  InvoiceStatus,
  OrganizationCountry,
} from '../../../generated/prisma/enums';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import {
  MOBILE_MONEY_PROVIDERS,
  type MobileMoneyProvider,
} from './providers/payment-provider.interface';
import type { InitiateCheckoutDto } from './dto/initiate-checkout.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly config: ConfigService,
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
    const country =
      invoice.event.organization?.country ?? OrganizationCountry.KENYA;
    const provider = this.providers.forCountry(country);

    const checkoutBaseUrl = this.config
      .get<string>('PUBLIC_CHECKOUT_BASE_URL')!
      .replace(/\/$/, '');

    if (country === OrganizationCountry.UGANDA) {
      if (!dto.phoneNumber || !isMobileMoneyProvider(dto.paymentMethod)) {
        throw new BadRequestException(
          'A phone number and network (MTN or Airtel) are required to pay this Uganda event',
        );
      }
      return provider.initializeCharge({
        email: dto.email,
        amount,
        reference,
        currency: 'UGX',
        metadata: { invoiceId: invoice.id, eventId: invoice.eventId },
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
      amount,
      reference,
      subaccountCode: subaccountCode ?? undefined,
      metadata: { invoiceId: invoice.id, eventId: invoice.eventId },
      callbackUrl: `${checkoutBaseUrl}/receipt`,
      channels:
        dto.paymentMethod && !isMobileMoneyProvider(dto.paymentMethod)
          ? [dto.paymentMethod]
          : undefined,
    });
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

function isMobileMoneyProvider(
  value: string | undefined,
): value is MobileMoneyProvider {
  return (MOBILE_MONEY_PROVIDERS as readonly string[]).includes(value ?? '');
}
