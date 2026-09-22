import { StripeWebhookProcessor } from './stripe-webhook.processor';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { StripeSubscriptionEvent } from './stripe-event.type';

function makeJob(event: StripeSubscriptionEvent) {
  return { data: event };
}

describe('StripeWebhookProcessor', () => {
  it('extends agencyPlanExpiresAt to current_period_end on a created subscription', async () => {
    const update = jest.fn();
    const record = jest.fn();
    const prisma = { organization: { update } } as unknown as PrismaService;
    const audit = { record } as unknown as AuditService;
    const processor = new StripeWebhookProcessor(prisma, audit);
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    await processor.process(
      makeJob({
        id: 'evt_1',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_1',
            status: 'active',
            current_period_end: periodEnd,
            metadata: { organizationId: 'org-1' },
          },
        },
      }) as never,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { agencyPlanExpiresAt: new Date(periodEnd * 1000) },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORGANIZATION_AGENCY_PLAN_ACTIVATED' }),
    );
  });

  it('records renewal (not activation) on an updated subscription', async () => {
    const update = jest.fn();
    const record = jest.fn();
    const prisma = { organization: { update } } as unknown as PrismaService;
    const audit = { record } as unknown as AuditService;
    const processor = new StripeWebhookProcessor(prisma, audit);
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    await processor.process(
      makeJob({
        id: 'evt_2',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            status: 'active',
            current_period_end: periodEnd,
            metadata: { organizationId: 'org-1' },
          },
        },
      }) as never,
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORGANIZATION_AGENCY_PLAN_RENEWED' }),
    );
  });

  it('does not extend the plan when the subscription is not active/trialing', async () => {
    const update = jest.fn();
    const record = jest.fn();
    const prisma = { organization: { update } } as unknown as PrismaService;
    const audit = { record } as unknown as AuditService;
    const processor = new StripeWebhookProcessor(prisma, audit);

    await processor.process(
      makeJob({
        id: 'evt_3',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            status: 'past_due',
            current_period_end: Math.floor(Date.now() / 1000),
            metadata: { organizationId: 'org-1' },
          },
        },
      }) as never,
    );

    expect(update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('records cancellation without touching agencyPlanExpiresAt on deletion', async () => {
    const update = jest.fn();
    const record = jest.fn();
    const prisma = { organization: { update } } as unknown as PrismaService;
    const audit = { record } as unknown as AuditService;
    const processor = new StripeWebhookProcessor(prisma, audit);

    await processor.process(
      makeJob({
        id: 'evt_4',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_1',
            status: 'canceled',
            current_period_end: Math.floor(Date.now() / 1000),
            metadata: { organizationId: 'org-1' },
          },
        },
      }) as never,
    );

    expect(update).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORGANIZATION_AGENCY_PLAN_CANCELLED' }),
    );
  });

  it('throws when the subscription metadata has no organizationId', async () => {
    const prisma = {
      organization: { update: jest.fn() },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const processor = new StripeWebhookProcessor(prisma, audit);

    await expect(
      processor.process(
        makeJob({
          id: 'evt_5',
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_1',
              status: 'active',
              current_period_end: Math.floor(Date.now() / 1000),
              metadata: {},
            },
          },
        }) as never,
      ),
    ).rejects.toThrow('has no organizationId');
  });
});
