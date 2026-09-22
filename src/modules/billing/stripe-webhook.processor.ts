import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { STRIPE_WEBHOOK_QUEUE } from './billing.constants';
import type { StripeSubscriptionEvent } from './stripe-event.type';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

@Processor(STRIPE_WEBHOOK_QUEUE)
export class StripeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  // Unlike WebhookProcessor (Transaction crediting), no idempotency check
  // is needed here: setting agencyPlanExpiresAt to the same value twice on
  // a redelivered event is harmless, since it's not incrementing anything.
  async process(job: Job<StripeSubscriptionEvent>) {
    const event = job.data;
    const subscription = event.data.object;
    const organizationId = subscription.metadata?.organizationId;
    if (!organizationId) {
      throw new Error(
        `Stripe event ${event.id} has no organizationId in subscription metadata`,
      );
    }

    if (event.type === 'customer.subscription.deleted') {
      await this.audit.record({
        action: 'ORGANIZATION_AGENCY_PLAN_CANCELLED',
        payload: { organizationId, stripeEventId: event.id },
      });
      return;
    }

    if (!ACTIVE_STATUSES.has(subscription.status)) {
      this.logger.log(
        `Subscription ${subscription.id} status is ${subscription.status}, not extending agency plan`,
      );
      return;
    }

    const agencyPlanExpiresAt = new Date(
      subscription.current_period_end * 1000,
    );
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { agencyPlanExpiresAt },
    });

    await this.audit.record({
      action:
        event.type === 'customer.subscription.created'
          ? 'ORGANIZATION_AGENCY_PLAN_ACTIVATED'
          : 'ORGANIZATION_AGENCY_PLAN_RENEWED',
      payload: {
        organizationId,
        agencyPlanExpiresAt: agencyPlanExpiresAt.toISOString(),
        stripeEventId: event.id,
      },
    });
  }
}
