import { NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const audit = { record: jest.fn() } as unknown as AuditService;
const config = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_AGENCY_PRICE_ID: 'price_123',
      PUBLIC_CHECKOUT_BASE_URL: 'http://localhost:5173',
    };
    return values[key];
  }),
} as unknown as ConfigService;

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe('BillingService.createCheckoutSession', () => {
  it('creates a Stripe customer first when the org has none yet, then a checkout session', async () => {
    const update = jest.fn();
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Agency Co',
          stripeCustomerId: null,
        }),
        update,
      },
    } as unknown as PrismaService;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'cus_123' }))
      .mockResolvedValueOnce(
        jsonResponse({ url: 'https://checkout.stripe.com/session_abc' }),
      );
    global.fetch = fetchMock;
    const service = new BillingService(prisma, audit, config);

    const result = await service.createCheckoutSession('org-1', 'user-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { stripeCustomerId: 'cus_123' },
    });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/session_abc' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses an existing stripeCustomerId without creating a new customer', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Agency Co',
          stripeCustomerId: 'cus_existing',
        }),
      },
    } as unknown as PrismaService;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ url: 'https://checkout.stripe.com/session_xyz' }),
      );
    global.fetch = fetchMock;
    const service = new BillingService(prisma, audit, config);

    const result = await service.createCheckoutSession('org-1', 'user-1');

    expect(result).toEqual({ url: 'https://checkout.stripe.com/session_xyz' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('BillingService.createPortalSession', () => {
  it('rejects when the organization has no billing account yet', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'org-1', stripeCustomerId: null }),
      },
    } as unknown as PrismaService;
    const service = new BillingService(prisma, audit, config);

    await expect(service.createPortalSession('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('BillingService.getStatus', () => {
  it('reports an active plan and free-client availability', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          agencyPlanExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
          stripeCustomerId: 'cus_1',
        }),
      },
      agencyClientLink: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaService;
    const service = new BillingService(prisma, audit, config);

    const result = await service.getStatus('org-1');

    expect(result).toEqual(
      expect.objectContaining({
        hasActivePlan: true,
        clientCount: 2,
        freeClientAvailable: false,
        hasBillingAccount: true,
      }),
    );
  });

  it('reports freeClientAvailable when no clients are linked yet', async () => {
    const prisma = {
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          agencyPlanExpiresAt: null,
          stripeCustomerId: null,
        }),
      },
      agencyClientLink: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new BillingService(prisma, audit, config);

    const result = await service.getStatus('org-1');

    expect(result).toEqual(
      expect.objectContaining({
        hasActivePlan: false,
        freeClientAvailable: true,
      }),
    );
  });
});
