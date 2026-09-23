import { StripeConnectService } from './stripe-connect.service';
import type { ConfigService } from '@nestjs/config';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const config = {
  get: jest.fn(() => 'sk_test_123'),
} as unknown as ConfigService;

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe('StripeConnectService.ensureAccount', () => {
  it('returns the existing account id without calling Stripe', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const service = new StripeConnectService(config);

    const accountId = await service.ensureAccount({
      existingAccountId: 'acct_existing',
      ownerType: 'ORGANIZATION',
      ownerId: 'org-1',
    });

    expect(accountId).toBe('acct_existing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a new Express account tagged with owner metadata when none exists', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'acct_new' }));
    global.fetch = fetchMock;
    const service = new StripeConnectService(config);

    const accountId = await service.ensureAccount({
      existingAccountId: null,
      ownerType: 'USER',
      ownerId: 'user-1',
      email: 'jane@example.com',
    });

    expect(accountId).toBe('acct_new');
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = (options.body as string) ?? '';
    expect(body).toContain('type=express');
    expect(body).toContain('metadata%5BownerType%5D=USER');
    expect(body).toContain('metadata%5BownerId%5D=user-1');
  });
});

describe('StripeConnectService.createOnboardingLink', () => {
  it('returns the hosted onboarding URL', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ url: 'https://connect.stripe.com/setup/abc' }),
      );
    global.fetch = fetchMock;
    const service = new StripeConnectService(config);

    const url = await service.createOnboardingLink(
      'acct_123',
      'https://openpool.app/return',
    );

    expect(url).toBe('https://connect.stripe.com/setup/abc');
  });
});
