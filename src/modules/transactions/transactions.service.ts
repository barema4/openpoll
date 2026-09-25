import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmailService } from '../../email/email.service';
import { PaystackProvider } from '../payments/providers/paystack.provider';
import { PawaPayProvider } from '../payments/providers/pawapay.provider';
import type { ParsedDisputeWebhookEvent } from '../payments/providers/paystack.provider';
import type { Prisma } from '../../../generated/prisma/client';
import {
  DisputeStatus,
  InvoiceStatus,
  OrgRole,
  PaymentRail,
  RefundStatus,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { RecordManualTransactionDto } from './dto/record-manual-transaction.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { AdminListTransactionsQueryDto } from './dto/admin-list-transactions-query.dto';
import type { AdminListDisputesQueryDto } from './dto/admin-list-disputes-query.dto';
import type { UpdateDisputeStatusDto } from './dto/update-dispute-status.dto';
import { paginate } from '../../common/pagination.util';
import { dayAfter } from '../../common/date-range.util';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly paystack: PaystackProvider,
    private readonly pawapay: PawaPayProvider,
    private readonly email: EmailService,
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

    let providerReference: string | undefined;
    let accepted: boolean;
    let failureMessage: string | undefined;

    // Branch on the gateway that actually processed this transaction
    // (persisted at creation time), not the organization's current
    // country — a provider cutover (e.g. Kenya moving from Paystack to
    // PawaPay) means those can disagree for an older transaction.
    if (transaction.gateway === 'PAWAPAY') {
      const refundId = randomUUID();
      const result = await this.pawapay.initiateRefund({
        refundId,
        depositId: transaction.providerReference,
        amount: grossAmount,
        currency: transaction.currency,
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

      await this.reverseTransactionCredit(
        tx,
        refund.transactionId,
        refund.transaction.amountSettled,
        refund.transaction.invoice,
      );
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

  // Shared by a completed refund and a dispute lost to the payer's bank —
  // both mean the same thing for our books: the org no longer has this
  // money. Flips the Transaction to REFUNDED (excluded from every
  // SUCCESS-scoped query automatically) and, only for single-use invoices
  // (mirrors the exact condition WebhookProcessor uses when incrementing
  // amountPaid), reverses the running total and recomputes status.
  private async reverseTransactionCredit(
    tx: Prisma.TransactionClient,
    transactionId: string,
    amountSettled: Prisma.Decimal | number,
    invoice: {
      id: string;
      amountPaid: Prisma.Decimal;
      amountRequested: Prisma.Decimal | null;
      expiresAt: Date | null;
    } | null,
  ) {
    await tx.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.REFUNDED },
    });

    if (invoice && invoice.expiresAt !== null) {
      const newAmountPaid = Math.max(
        Number(invoice.amountPaid) - Number(amountSettled),
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
  }

  // Handles every charge.dispute.* event for a given dispute (create,
  // periodic reminders, and the final resolution) — called from
  // DisputeWebhookProcessor. An open/pending dispute never touches the
  // linked Transaction's status: the money hasn't moved yet, and a
  // disputed-but-still-good transaction must stay in the budget pool /
  // withdrawal balance. Only a resolution of 'merchant-accepted' (the
  // chargeback stands) reverses the transaction, via the same shared logic
  // a completed refund uses.
  async handleDisputeEvent(event: ParsedDisputeWebhookEvent) {
    const existing = await this.prisma.dispute.findUnique({
      where: { providerReference: event.providerReference },
    });
    const isNew = !existing;

    const transaction = await this.prisma.transaction.findUnique({
      where: { providerReference: event.transactionReference },
      include: { invoice: true },
    });

    const dispute = await this.prisma.dispute.upsert({
      where: { providerReference: event.providerReference },
      create: {
        providerReference: event.providerReference,
        transactionId: transaction?.id,
        status: event.status,
        resolution: event.resolution,
        amount: event.amount,
        reason: event.reason,
        resolvedAt: event.status === DisputeStatus.RESOLVED ? new Date() : null,
      },
      update: {
        status: event.status,
        resolution: event.resolution,
        resolvedAt: event.status === DisputeStatus.RESOLVED ? new Date() : null,
      },
    });

    if (isNew) {
      await this.audit.record({
        eventId: transaction?.eventId,
        action: 'DISPUTE_OPENED',
        payload: { disputeId: dispute.id, amount: event.amount },
      });
      await this.notifyDispute(dispute.id);
    }

    // Only reverse once, and only if the transaction hasn't already been
    // refunded/reversed by some other path (e.g. an organizer-initiated
    // refund for the same charge, or a redelivered resolve webhook).
    if (
      event.status === DisputeStatus.RESOLVED &&
      event.resolution === 'merchant-accepted' &&
      transaction &&
      transaction.status === TransactionStatus.SUCCESS
    ) {
      await this.prisma.$transaction((tx) =>
        this.reverseTransactionCredit(
          tx,
          transaction.id,
          transaction.amountSettled,
          transaction.invoice,
        ),
      );
      await this.audit.record({
        eventId: transaction.eventId,
        action: 'DISPUTE_LOST',
        payload: { disputeId: dispute.id, transactionId: transaction.id },
      });
    } else if (event.status === DisputeStatus.RESOLVED) {
      await this.audit.record({
        eventId: transaction?.eventId,
        action: 'DISPUTE_RESOLVED',
        payload: { disputeId: dispute.id, resolution: event.resolution },
      });
    }
  }

  // Platform-wide dispute listing for staff support lookups (see
  // AdminDisputesController) — every organization's disputes, not scoped to
  // a single event the way the rest of this service is.
  async listDisputesForAdmin(query: AdminListDisputesQueryDto) {
    const { page = 1, pageSize = 10, status } = query;
    const where: Prisma.DisputeWhereInput = { ...(status && { status }) };
    const [data, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        include: {
          transaction: {
            include: {
              event: {
                select: {
                  id: true,
                  title: true,
                  organization: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }

  // Manual override for staff — a Dispute's status normally only moves via
  // Paystack's own webhooks (handleDisputeEvent above); this covers
  // resolutions reached outside the app (e.g. directly with the payer's
  // bank) that no webhook will ever report.
  async updateDisputeStatus(
    userId: string,
    disputeId: string,
    dto: UpdateDisputeStatusDto,
  ) {
    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: dto.status,
        resolution: dto.resolution,
        resolvedAt: dto.status === DisputeStatus.RESOLVED ? new Date() : null,
      },
    });

    await this.audit.record({
      userId,
      action: 'DISPUTE_STATUS_OVERRIDDEN',
      payload: {
        disputeId,
        status: dto.status,
        resolution: dto.resolution ?? null,
      },
    });

    return updated;
  }

  // Emails the org's admins the moment a dispute opens — there's typically
  // a response deadline, so this is the one actionable moment worth
  // notifying on (reminders/resolution are audit-logged but don't re-notify).
  private async notifyDispute(disputeId: string) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: {
        transaction: {
          include: { event: { select: { organizationId: true, title: true } } },
        },
      },
    });
    const organizationId = dispute.transaction?.event.organizationId;
    if (!organizationId) return; // No org to notify (orphaned/untracked transaction).

    const admins = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        role: { in: [OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER] },
      },
      include: { user: { select: { email: true } } },
    });

    const eventTitle = dispute.transaction?.event.title ?? 'an event';
    const amount = Number(dispute.amount);
    await Promise.all(
      admins.map((admin) =>
        this.email.send({
          to: admin.user.email,
          subject: `A payment to ${eventTitle} has been disputed`,
          html: `<p>A payer's bank has disputed a charge of ${amount} to <strong>${eventTitle}</strong>.
            Paystack usually requires a response within a few days — check your Paystack dashboard for the
            deadline and details.</p>`,
        }),
      ),
    );
  }

  findOne(transactionId: string) {
    return this.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { disputes: true },
    });
  }

  async listForEvent(query: ListTransactionsQueryDto) {
    const {
      eventId,
      page = 1,
      pageSize = 10,
      search,
      status,
      paymentRail,
      dateFrom,
      dateTo,
    } = query;
    const where: Prisma.TransactionWhereInput = {
      eventId,
      ...(status && { status }),
      ...(paymentRail && { paymentRail }),
      ...((dateFrom || dateTo) && {
        timestamp: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lt: dayAfter(dateTo) }),
        },
      }),
      ...(search && {
        OR: [
          { providerReference: { contains: search, mode: 'insensitive' } },
          { note: { contains: search, mode: 'insensitive' } },
          {
            invoice: {
              contributorName: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { disputes: true },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }

  // Platform-wide equivalent of listForEvent() — every organization's
  // transactions, for staff support lookups (see AdminTransactionsController).
  async listAllForAdmin(query: AdminListTransactionsQueryDto) {
    const {
      page = 1,
      pageSize = 10,
      search,
      organizationId,
      status,
      gateway,
      dateFrom,
      dateTo,
    } = query;
    const where: Prisma.TransactionWhereInput = {
      ...(status && { status }),
      ...(gateway && { gateway }),
      ...(organizationId && { event: { organizationId } }),
      ...((dateFrom || dateTo) && {
        timestamp: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lt: dayAfter(dateTo) }),
        },
      }),
      ...(search && {
        OR: [
          { providerReference: { contains: search, mode: 'insensitive' } },
          { event: { title: { contains: search, mode: 'insensitive' } } },
          {
            event: {
              organization: { name: { contains: search, mode: 'insensitive' } },
            },
          },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          disputes: true,
          refund: true,
          event: {
            select: {
              id: true,
              title: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return paginate(data, total, page, pageSize);
  }

  // Unauthenticated, keyed by the gateway's own reference (unguessable,
  // same trust model as an invoice secureToken) — this is what a payer's
  // browser lands on via the Paystack callback_url after paying.
  async getReceipt(providerReference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { providerReference },
      include: {
        event: {
          include: { organization: { select: { name: true, logoUrl: true } } },
        },
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
        ? {
            name: transaction.event.organization.name,
            logoUrl: transaction.event.organization.logoUrl,
          }
        : null,
      invoiceRemainingBalance: remainingBalance,
    };
  }
}
