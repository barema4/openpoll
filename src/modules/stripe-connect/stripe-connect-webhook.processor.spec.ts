import { StripeConnectWebhookProcessor } from './stripe-connect-webhook.processor';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { StripeAccountEvent } from './stripe-account-event.type';

function makeJob(event: StripeAccountEvent) {
  return { data: event };
}

describe('StripeConnectWebhookProcessor', () => {
  it('flips stripeConnectPayoutsEnabled on the organization when payouts_enabled is true', async () => {
    const update = jest.fn();
    const record = jest.fn();
    const prisma = { organization: { update } } as unknown as PrismaService;
    const audit = { record } as unknown as AuditService;
    const processor = new StripeConnectWebhookProcessor(prisma, audit);

    await processor.process(
      makeJob({
        id: 'evt_1',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_1',
            details_submitted: true,
            charges_enabled: true,
            payouts_enabled: true,
            metadata: { ownerType: 'ORGANIZATION', ownerId: 'org-1' },
          },
        },
      }) as never,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { stripeConnectPayoutsEnabled: true },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STRIPE_CONNECT_ACCOUNT_UPDATED',
        payload: {
          ownerType: 'ORGANIZATION',
          ownerId: 'org-1',
          payoutsEnabled: true,
        },
      }),
    );
  });

  it('flips stripeConnectPayoutsEnabled on the user when the owner is a USER', async () => {
    const update = jest.fn();
    const prisma = { user: { update } } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const processor = new StripeConnectWebhookProcessor(prisma, audit);

    await processor.process(
      makeJob({
        id: 'evt_2',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_2',
            details_submitted: true,
            charges_enabled: true,
            payouts_enabled: false,
            metadata: { ownerType: 'USER', ownerId: 'user-1' },
          },
        },
      }) as never,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { stripeConnectPayoutsEnabled: false },
    });
  });

  it('throws when the account has no owner metadata', async () => {
    const prisma = {
      organization: { update: jest.fn() },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const processor = new StripeConnectWebhookProcessor(prisma, audit);

    await expect(
      processor.process(
        makeJob({
          id: 'evt_3',
          type: 'account.updated',
          data: {
            object: {
              id: 'acct_3',
              details_submitted: true,
              charges_enabled: true,
              payouts_enabled: true,
              metadata: {},
            },
          },
        }) as never,
      ),
    ).rejects.toThrow('has no owner metadata');
  });
});
