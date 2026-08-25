import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { InvoiceStatus } from '../../../generated/prisma/enums';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.interface';
import type { InitiateCheckoutDto } from './dto/initiate-checkout.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
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

    const amount = isSingleUse
      ? this.resolveSingleUseChargeAmount(invoice, dto)
      : this.resolvePermanentLinkChargeAmount(dto, invoice.amountRequested);

    const subaccountCode =
      invoice.event.gatewayWalletId ??
      invoice.event.organization?.gatewayWalletId;
    const reference = `op_${randomBytes(12).toString('hex')}`;

    const appBaseUrl = this.config
      .get<string>('APP_BASE_URL')!
      .replace(/\/$/, '');

    const result = await this.provider.initializeCharge({
      email: dto.email,
      amount,
      reference,
      subaccountCode: subaccountCode ?? undefined,
      metadata: { invoiceId: invoice.id, eventId: invoice.eventId },
      callbackUrl: `${appBaseUrl}/public/receipts`,
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
