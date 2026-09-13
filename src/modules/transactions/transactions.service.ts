import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { RecordManualTransactionDto } from './dto/record-manual-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // For money received outside the app — cash, a direct mobile money
  // transfer straight to the org's own line — logged so the event's
  // collected total and budget-allocation pool stay accurate even when not
  // every contribution flows through the payment gateway. Deliberately
  // status: SUCCESS (the org already has this money in hand) but
  // paymentRail: MANUAL, which WithdrawalsService.getBalance() excludes —
  // it was never actually deposited into the platform's PawaPay balance, so
  // it must never be withdrawable.
  async recordManual(userId: string, dto: RecordManualTransactionDto) {
    const transaction = await this.prisma.transaction.create({
      data: {
        eventId: dto.eventId,
        providerReference: `manual:${randomUUID()}`,
        paymentRail: PaymentRail.MANUAL,
        amountSettled: dto.amount,
        status: TransactionStatus.SUCCESS,
        recordedByUserId: userId,
        note: dto.note,
      },
    });

    await this.audit.record({
      userId,
      eventId: dto.eventId,
      action: 'MANUAL_CONTRIBUTION_RECORDED',
      payload: {
        transactionId: transaction.id,
        amount: dto.amount,
        note: dto.note ?? null,
      },
    });

    return transaction;
  }

  findOne(transactionId: string) {
    return this.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
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

    const platformFeeAmount = Number(transaction.platformFeeAmount);

    return {
      receiptNumber: transaction.providerReference,
      amountPaid: Number(transaction.amountSettled),
      platformFeeAmount,
      totalCharged: Number(transaction.amountSettled) + platformFeeAmount,
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
