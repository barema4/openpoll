import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionStatus } from '../../../generated/prisma/enums';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(transactionId: string) {
    return this.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { allocations: true },
    });
  }

  listForEvent(eventId: string) {
    return this.prisma.transaction.findMany({
      where: { eventId },
      orderBy: { timestamp: 'desc' },
    });
  }

  // Unauthenticated, keyed by the gateway's own reference (unguessable,
  // same trust model as an invoice secureToken) — this is what a payer's
  // browser lands on via the Paystack callback_url after paying.
  async getReceipt(providerReference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { providerReference },
      include: {
        event: { include: { organization: { select: { name: true } } } },
        invoice: {
          select: {
            contributorName: true,
            categoryTag: true,
            amountRequested: true,
            amountPaid: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(
        'Receipt not found — if you just paid, this may still be processing. Try again shortly.',
      );
    }
    if (transaction.status !== TransactionStatus.SUCCESS) {
      throw new NotFoundException(
        'No receipt available for an unsuccessful payment',
      );
    }

    const remainingBalance = transaction.invoice?.amountRequested
      ? Math.max(
          Number(transaction.invoice.amountRequested) -
            Number(transaction.invoice.amountPaid),
          0,
        )
      : null;

    return {
      receiptNumber: transaction.providerReference,
      amountPaid: Number(transaction.amountSettled),
      paymentRail: transaction.paymentRail,
      paidAt: transaction.timestamp,
      payerName: transaction.invoice?.contributorName ?? null,
      categoryTag: transaction.invoice?.categoryTag ?? null,
      event: { id: transaction.event.id, title: transaction.event.title },
      organization: transaction.event.organization
        ? { name: transaction.event.organization.name }
        : null,
      invoiceRemainingBalance: remainingBalance,
    };
  }
}
