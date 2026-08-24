import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
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
      throw new BadRequestException('This invoice has already been paid');
    }
    if (isSingleUse && invoice.expiresAt! < new Date()) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.EXPIRED },
      });
      throw new BadRequestException('This invoice has expired');
    }

    const amount = invoice.amountRequested
      ? Number(invoice.amountRequested)
      : dto.amount;
    if (!amount) {
      throw new BadRequestException(
        'An amount is required for this payment link',
      );
    }

    const subaccountCode =
      invoice.event.gatewayWalletId ??
      invoice.event.organization?.gatewayWalletId;
    const reference = `op_${randomBytes(12).toString('hex')}`;

    const result = await this.provider.initializeCharge({
      email: dto.email,
      amount,
      reference,
      subaccountCode: subaccountCode ?? undefined,
      metadata: { invoiceId: invoice.id, eventId: invoice.eventId },
    });

    return result;
  }
}
