import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import {
  InvoiceStatus,
  OrganizationCountry,
  PaymentRail,
  RefundStatus,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { RecordManualTransactionDto } from './dto/record-manual-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly paystack: PaystackProvider,
    private readonly pawapay: PawaPayProvider,
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

  // Full refund only (no partial) — the payer gets back everything they
  // paid, platform fee included. Completion is async (webhook/callback);
  // see completeRefund() for the reversal logic once it lands.
  async refund(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { event: { include: { organization: true } } },
    });

    if (transaction.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException(
        'Only a successfully settled transaction can be refunded',
      );
    }
    if (transaction.paymentRail === PaymentRail.MANUAL) {
      throw new BadRequestException(
        'Manually recorded contributions have no gateway charge to refund — adjust the record directly instead',
      );
    }
    const existingRefund = await this.prisma.refund.findUnique({
      where: { transactionId },
    });
    // A FAILED refund (e.g. a transient gateway error) is retryable — only a
    // completed or still in-flight refund actually blocks a new attempt.
    if (existingRefund && existingRefund.status !== RefundStatus.FAILED) {
      throw new BadRequestException(
        'This transaction has already been refunded or has a refund in progress',
      );
    }

    const grossAmount =
      Number(transaction.amountSettled) + Number(transaction.platformFeeAmount);
    const country =
      transaction.event.organization?.country ?? OrganizationCountry.KENYA;

    let providerReference: string | undefined;
    let accepted: boolean;
    let failureMessage: string | undefined;

    if (country === OrganizationCountry.UGANDA) {
      const refundId = randomUUID();
      const result = await this.pawapay.initiateRefund({
        refundId,
        depositId: transaction.providerReference,
        amount: grossAmount,
        currency: 'UGX',
      });
      providerReference = refundId;
      accepted = result.accepted;
      failureMessage = result.failureMessage;
    } else {
      const result = await this.paystack.initiateRefund({
        transactionReference: transaction.providerReference,
      });
      providerReference = result.accepted ? result.refundReference : undefined;
      accepted = result.accepted;
      failureMessage = result.failureMessage;
    }

    // upsert, not create: retrying after a prior FAILED attempt reuses the
    // same row (the unique transactionId constraint would otherwise reject
    // a second insert for this transaction).
    const refundData = {
      amount: grossAmount,
      status: accepted ? RefundStatus.PROCESSING : RefundStatus.FAILED,
      providerReference,
      requestedByUserId: userId,
      failureReason: failureMessage ?? null,
    };
    const refund = await this.prisma.refund.upsert({
      where: { transactionId },
      create: { transactionId, ...refundData },
      update: refundData,
    });

    await this.audit.record({
      userId,
      eventId: transaction.eventId,
      action: 'REFUND_REQUESTED',
      payload: { transactionId, refundId: refund.id, amount: grossAmount },
    });

    return refund;
  }

  // Shared reversal logic, called from both the Paystack refund-webhook
  // processor (async, queued) and the PawaPay callback controller
  // (synchronous, mirroring how payout completion is already handled).
  async completeRefund(
    providerReference: string,
    succeeded: boolean,
    failureMessage?: string,
  ) {
    const refund = await this.prisma.refund.findUnique({
      where: { providerReference },
      include: { transaction: { include: { invoice: true } } },
    });
    if (!refund) return; // Unknown/foreign reference — nothing of ours to update.
    if (
      refund.status === RefundStatus.COMPLETED ||
      refund.status === RefundStatus.FAILED
    ) {
      return; // Already processed — redelivered callback.
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: succeeded ? RefundStatus.COMPLETED : RefundStatus.FAILED,
          completedAt: succeeded ? new Date() : undefined,
          failureReason: failureMessage,
        },
      });

      if (!succeeded) return;

      await tx.transaction.update({
        where: { id: refund.transactionId },
        data: { status: TransactionStatus.REFUNDED },
      });

      // Only single-use invoices track a running amountPaid total — mirrors
      // the exact condition WebhookProcessor uses when incrementing it.
      const invoice = refund.transaction.invoice;
      if (invoice && invoice.expiresAt !== null) {
        const newAmountPaid = Math.max(
          Number(invoice.amountPaid) - Number(refund.transaction.amountSettled),
          0,
        );
        const target = Number(invoice.amountRequested ?? 0);
        const nextStatus =
          newAmountPaid <= 0
            ? InvoiceStatus.PENDING
            : newAmountPaid >= target
              ? InvoiceStatus.PAID
              : InvoiceStatus.PARTIALLY_PAID;

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { amountPaid: newAmountPaid, status: nextStatus },
        });
      }
    });

    await this.audit.record({
      eventId: refund.transaction.eventId,
      action: succeeded ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
      payload: {
        refundId: refund.id,
        transactionId: refund.transactionId,
        failureReason: failureMessage ?? null,
      },
    });
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
