import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  InvoiceStatus,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import { WEBHOOK_QUEUE } from './payments.constants';
import type { ParsedWebhookEvent } from './providers/payment-provider.interface';

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<ParsedWebhookEvent>) {
    const event = job.data;

    // Idempotency anchor: provider_reference is unique, so a redelivered
    // webhook (Paystack retries on non-2xx, or duplicate deliveries) is a no-op.
    const existing = await this.prisma.transaction.findUnique({
      where: { providerReference: event.providerReference },
    });
    if (existing) {
      this.logger.log(
        `Duplicate webhook for ${event.providerReference}, skipping`,
      );
      return;
    }

    const eventId =
      event.eventId ?? (await this.resolveEventIdFromInvoice(event.invoiceId));
    if (!eventId) {
      throw new Error(
        `Cannot resolve eventId for webhook ${event.providerReference} — missing metadata`,
      );
    }

    const transaction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          invoiceId: event.invoiceId,
          eventId,
          providerReference: event.providerReference,
          paymentRail: event.paymentRail,
          amountSettled: event.amountSettled,
          status: event.status,
        },
      });

      // Single-use invoices carry a fixed target and accept repeated partial
      // payments — track the running total and only close (PAID) once it's
      // met. Permanent links are uncapped and never change status here.
      if (event.status === TransactionStatus.SUCCESS && event.invoiceId) {
        const invoice = await tx.invoice.findUnique({
          where: { id: event.invoiceId },
        });

        if (
          invoice &&
          invoice.expiresAt !== null &&
          invoice.status !== InvoiceStatus.PAID
        ) {
          const updated = await tx.invoice.update({
            where: { id: event.invoiceId },
            data: { amountPaid: { increment: event.amountSettled } },
          });

          const target = Number(invoice.amountRequested ?? 0);
          const paid = Number(updated.amountPaid);
          const nextStatus =
            paid >= target ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

          if (nextStatus !== updated.status) {
            await tx.invoice.update({
              where: { id: event.invoiceId },
              data: { status: nextStatus },
            });
          }
        }
      }

      return created;
    });

    await this.audit.record({
      eventId,
      action: 'TRANSACTION_SETTLED',
      payload: {
        transactionId: transaction.id,
        providerReference: event.providerReference,
      },
    });
  }

  private async resolveEventIdFromInvoice(
    invoiceId?: string,
  ): Promise<string | null> {
    if (!invoiceId) return null;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { eventId: true },
    });
    return invoice?.eventId ?? null;
  }
}
