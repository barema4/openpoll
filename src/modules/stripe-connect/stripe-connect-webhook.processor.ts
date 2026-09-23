import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { STRIPE_CONNECT_WEBHOOK_QUEUE } from './stripe-connect.constants';
import type { StripeAccountEvent } from './stripe-account-event.type';

@Processor(STRIPE_CONNECT_WEBHOOK_QUEUE)
export class StripeConnectWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeConnectWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  // Idempotent by nature (setting payoutsEnabled to the same value twice on
  // a redelivered event is harmless), same reasoning as StripeWebhookProcessor
  // (BillingModule) — no dedup check needed.
  async process(job: Job<StripeAccountEvent>) {
    const account = job.data.data.object;
    // account.metadata is attacker/Stripe-controlled JSON at runtime, not
    // actually guaranteed to match StripeConnectOwnerType despite the
    // declared type — ownerTypeLabel keeps a plain-string handle on it for
    // the defensive "else" branch below, independent of ownerType's
    // narrowing through the if/else-if chain.
    const { ownerType, ownerId } = account.metadata ?? {};
    const ownerTypeLabel: string | undefined = ownerType;
    if (!ownerType || !ownerId) {
      throw new Error(
        `Stripe account.updated event for ${account.id} has no owner metadata`,
      );
    }

    const payoutsEnabled = account.payouts_enabled === true;

    if (ownerType === 'ORGANIZATION') {
      await this.prisma.organization.update({
        where: { id: ownerId },
        data: { stripeConnectPayoutsEnabled: payoutsEnabled },
      });
    } else if (ownerType === 'USER') {
      await this.prisma.user.update({
        where: { id: ownerId },
        data: { stripeConnectPayoutsEnabled: payoutsEnabled },
      });
    } else {
      this.logger.warn(`Unknown Stripe Connect owner type: ${ownerTypeLabel}`);
      return;
    }

    await this.audit.record({
      userId: ownerType === 'USER' ? ownerId : null,
      action: 'STRIPE_CONNECT_ACCOUNT_UPDATED',
      payload: { ownerType, ownerId, payoutsEnabled },
    });
  }
}
