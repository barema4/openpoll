import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  OrganizationCountry,
  PersonalInvoiceStatus,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from './personal-invoices.constants';
import { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';
import type { ParsedWebhookEvent } from '../payments/providers/payment-provider.interface';

const AMOUNT_TOLERANCE = 0.01;

@Processor(PERSONAL_INVOICE_WEBHOOK_QUEUE)
export class PersonalInvoiceWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(PersonalInvoiceWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: PaymentProviderRegistry,
  ) {
    super();
  }

  async process(job: Job<ParsedWebhookEvent>) {
    const event = job.data;
    const personalInvoiceId = event.personalInvoiceId;
    if (!personalInvoiceId) {
      throw new Error(
        `Personal invoice webhook ${event.providerReference} is missing personalInvoiceId metadata`,
      );
    }

    // Idempotency anchor: provider_reference is unique, so a redelivered
    // webhook (Paystack retries on non-2xx, or duplicate deliveries) is a no-op.
    const existing = await this.prisma.personalInvoiceTransaction.findUnique({
      where: { providerReference: event.providerReference },
    });
    if (existing) {
      this.logger.log(
        `Duplicate webhook for ${event.providerReference}, skipping`,
      );
      return;
    }

    // Defense-in-depth: a webhook signature check proves the payload came
    // from the gateway, but not that its body wasn't manipulated upstream of
    // signing, nor guards against a bug in that check. Before crediting
    // anything, independently confirm status + amount directly with
    // whichever provider (Paystack/Kenya or PawaPay/Uganda) this invoice's
    // issuer uses.
    let amountSettled = event.amountSettled;
    if (event.status === TransactionStatus.SUCCESS) {
      const provider = await this.resolveProviderForInvoice(personalInvoiceId);
      const verified = await provider.verifyTransaction(
        event.providerReference,
      );
      if (verified.status !== TransactionStatus.SUCCESS) {
        throw new Error(
          `Webhook claimed SUCCESS for ${event.providerReference} but gateway verify returned ${verified.status} — refusing to credit`,
        );
      }
      if (
        Math.abs(verified.amountSettled - event.amountSettled) >
        AMOUNT_TOLERANCE
      ) {
        throw new Error(
          `Webhook amount (${event.amountSettled}) does not match verified amount (${verified.amountSettled}) for ${event.providerReference} — refusing to credit`,
        );
      }
      amountSettled = verified.amountSettled;
    }

    const transaction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.personalInvoiceTransaction.create({
        data: {
          personalInvoiceId,
          providerReference: event.providerReference,
          paymentRail: event.paymentRail,
          amountSettled,
          status: event.status,
        },
      });

      // One invoice, one payment — no partial-payment state machine needed.
      if (event.status === TransactionStatus.SUCCESS) {
        await tx.personalInvoice.updateMany({
          where: {
            id: personalInvoiceId,
            status: { not: PersonalInvoiceStatus.PAID },
          },
          data: {
            amountPaid: amountSettled,
            status: PersonalInvoiceStatus.PAID,
            paidAt: new Date(),
          },
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'PERSONAL_INVOICE_PAID',
      payload: {
        personalInvoiceId,
        transactionId: transaction.id,
        providerReference: event.providerReference,
      },
    });
  }

  private async resolveProviderForInvoice(personalInvoiceId: string) {
    const invoice = await this.prisma.personalInvoice.findUniqueOrThrow({
      where: { id: personalInvoiceId },
      select: { issuer: { select: { country: true } } },
    });
    return this.providers.forCountry(
      invoice.issuer?.country ?? OrganizationCountry.KENYA,
    );
  }
}
