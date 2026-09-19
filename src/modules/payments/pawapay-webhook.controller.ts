import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { PawaPayProvider } from './providers/pawapay.provider';
import { WEBHOOK_QUEUE } from './payments.constants';
import { PERSONAL_INVOICE_WEBHOOK_QUEUE } from '../personal-invoices/personal-invoices.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TransactionsService } from '../transactions/transactions.service';
import {
  DisbursementStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums';

interface PawaPayCallbackBody {
  depositId?: string;
  payoutId?: string;
  refundId?: string;
  status: string;
  failureReason?: { failureMessage?: string };
}

// Uganda/PawaPay callbacks — deposits (contributions) and payouts
// (withdrawals) share one configured callback URL in PawaPay's dashboard,
// dispatched here by which id is present. Signature scheme is RFC-9421
// (see PawaPayProvider.verifyWebhookSignature), not Paystack's HMAC header.
@ApiTags('payments')
@Controller('payments/webhooks')
export class PawaPayWebhookController {
  constructor(
    private readonly provider: PawaPayProvider,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionsService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(PERSONAL_INVOICE_WEBHOOK_QUEUE)
    private readonly personalInvoiceWebhookQueue: Queue,
  ) {}

  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @Post('pawapay')
  async handlePawaPayWebhook(@Req() request: RawBodyRequest<Request>) {
    if (!request.rawBody || !this.provider.verifyWebhookSignature(request)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const body = JSON.parse(
      request.rawBody.toString('utf8'),
    ) as PawaPayCallbackBody;

    if (body.payoutId) {
      await this.handlePayoutCallback(body);
      return { received: true };
    }
    if (body.refundId) {
      await this.transactions.completeRefund(
        body.refundId,
        body.status === 'COMPLETED',
        body.failureReason?.failureMessage,
      );
      return { received: true };
    }

    // Deposit (contribution) — same downstream processing as a Paystack
    // charge from here on, so it shares the existing processors/queues,
    // dispatched the same way WebhookController does for Paystack.
    const event = this.provider.parseWebhookEvent(request.rawBody);
    const queue = event.personalInvoiceId
      ? this.personalInvoiceWebhookQueue
      : this.webhookQueue;
    await queue.add('process-webhook', event, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });

    return { received: true };
  }

  // A payoutId belongs to either an organizer withdrawal or a vendor
  // disbursement — both share this one PawaPay callback URL, distinguished
  // by which table has a row with this providerReference/gatewayTransferRef.
  private async handlePayoutCallback(body: PawaPayCallbackBody) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { providerReference: body.payoutId },
    });
    if (withdrawal) {
      await this.completeWithdrawal(withdrawal, body);
      return;
    }

    const disbursement = await this.prisma.disbursement.findUnique({
      where: { gatewayTransferRef: body.payoutId },
    });
    if (disbursement) {
      await this.completeDisbursement(disbursement, body);
      return;
    }
    // Unknown/foreign payout — nothing of ours to update.
  }

  private async completeWithdrawal(
    withdrawal: {
      id: string;
      organizationId: string;
      status: WithdrawalStatus;
    },
    body: PawaPayCallbackBody,
  ) {
    const nextStatus =
      body.status === 'COMPLETED'
        ? WithdrawalStatus.COMPLETED
        : WithdrawalStatus.FAILED;
    if (withdrawal.status === nextStatus) return; // Already processed — redelivered callback.

    await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: nextStatus,
        completedAt:
          nextStatus === WithdrawalStatus.COMPLETED ? new Date() : undefined,
        failureReason: body.failureReason?.failureMessage,
      },
    });

    await this.audit.record({
      action:
        nextStatus === WithdrawalStatus.COMPLETED
          ? 'WITHDRAWAL_COMPLETED'
          : 'WITHDRAWAL_FAILED',
      payload: {
        withdrawalId: withdrawal.id,
        organizationId: withdrawal.organizationId,
      },
    });
  }

  private async completeDisbursement(
    disbursement: {
      id: string;
      eventId: string;
      budgetCategoryId: string | null;
      status: DisbursementStatus;
    },
    body: PawaPayCallbackBody,
  ) {
    const nextStatus =
      body.status === 'COMPLETED'
        ? DisbursementStatus.SUCCESS
        : DisbursementStatus.FAILED;
    if (disbursement.status === nextStatus) return; // Already processed — redelivered callback.

    await this.prisma.disbursement.update({
      where: { id: disbursement.id },
      data: {
        status: nextStatus,
        failureReason: body.failureReason?.failureMessage,
      },
    });

    await this.audit.record({
      eventId: disbursement.eventId,
      action:
        nextStatus === DisbursementStatus.SUCCESS
          ? 'VENDOR_PAYOUT_COMPLETED'
          : 'VENDOR_PAYOUT_FAILED',
      payload: {
        disbursementId: disbursement.id,
        budgetCategoryId: disbursement.budgetCategoryId,
      },
    });
  }
}
