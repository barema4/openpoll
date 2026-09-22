import { PaymentsService } from './payments.service';
import { InvoiceStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { PaymentProviderRegistry } from './providers/payment-provider.registry';

function makeConfig(platformFeePercent: number) {
  return {
    get: jest.fn((key: string) =>
      key === 'PLATFORM_FEE_PERCENT'
        ? platformFeePercent
        : 'http://localhost:3001',
    ),
  } as unknown as ConfigService;
}

function makeAudit() {
  return { record: jest.fn() } as unknown as AuditService;
}

describe('PaymentsService.initializeCheckout — platform fee', () => {
  function makeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      eventId: 'event-1',
      secureToken: 'tok-abc',
      status: InvoiceStatus.PENDING,
      expiresAt: null,
      amountRequested: null,
      amountPaid: '0',
      contributorEmail: 'payer@example.com',
      contributorName: null,
      contributorPhone: null,
      event: {
        gatewayWalletId: 'ACCT_123',
        organization: { country: 'KE', gatewayWalletId: null },
      },
      ...overrides,
    };
  }

  function makePrisma(invoice: unknown) {
    return {
      invoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        update: jest.fn().mockResolvedValue(invoice),
      },
    } as unknown as PrismaService;
  }

  it('charges the gross (base + fee) amount, crediting the event with exactly the payer-chosen amount via metadata', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'redirect',
      authorizationUrl: 'https://paystack.test/pay',
      reference: 'ref-1',
    });
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrisma(makeInvoice());
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(1.5),
      makeAudit(),
    );

    await service.initializeCheckout('tok-abc', {
      email: 'payer@example.com',
      amount: 1000,
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1015,
        subaccountCode: 'ACCT_123',
        platformFeeAmount: 15,
        metadata: expect.objectContaining({
          invoiceId: 'inv-1',
          eventId: 'event-1',
          platformFeeAmount: 15,
        }) as unknown,
      }),
    );
  });

  it('charges the exact amount with no fee when PLATFORM_FEE_PERCENT is 0', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'redirect',
      authorizationUrl: 'https://paystack.test/pay',
      reference: 'ref-1',
    });
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrisma(makeInvoice());
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(0),
      makeAudit(),
    );

    await service.initializeCheckout('tok-abc', {
      email: 'payer@example.com',
      amount: 1000,
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, platformFeeAmount: 0 }),
    );
  });

  it('includes the fee for a Uganda event too, passed through metadata since PawaPay has no gateway-level split', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'pending',
      reference: 'ref-1',
    });
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const invoice = makeInvoice({
      event: {
        gatewayWalletId: null,
        organization: { country: 'UG', gatewayWalletId: null },
      },
    });
    const prisma = makePrisma(invoice);
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(1.5),
      makeAudit(),
    );

    await service.initializeCheckout('tok-abc', {
      email: 'payer@example.com',
      amount: 1000,
      paymentMethod: 'MTN_MOMO_UGA',
      phoneNumber: '256771234567',
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1015,
        currency: 'UGX',
        metadata: expect.objectContaining({ platformFeeAmount: 15 }) as unknown,
      }),
    );
  });
});

describe('PaymentsService.initiateDeposit', () => {
  const user = { id: 'user-1', email: 'owner@example.com' };

  function makePrismaForEvent(event: unknown) {
    return {
      event: { findUnique: jest.fn().mockResolvedValue(event) },
    } as unknown as PrismaService;
  }

  it('charges exactly the requested amount with zero fee for a Uganda deposit', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'pending',
      reference: 'ref-1',
    });
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrismaForEvent({
      id: 'event-1',
      gatewayWalletId: null,
      organization: { country: 'UG', gatewayWalletId: null },
    });
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(1.5),
      makeAudit(),
    );

    await service.initiateDeposit(user, 'event-1', {
      amount: 500,
      paymentMethod: 'MTN_MOMO_UGA',
      phoneNumber: '256771234567',
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        currency: 'UGX',
        email: 'owner@example.com',
        metadata: { eventId: 'event-1', platformFeeAmount: 0 },
        mobileMoney: {
          phoneNumber: '256771234567',
          provider: 'MTN_MOMO_UGA',
        },
      }),
    );
  });

  it('rejects a Uganda deposit missing a phone number/network', async () => {
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge: jest.fn() }),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrismaForEvent({
      id: 'event-1',
      gatewayWalletId: null,
      organization: { country: 'UG', gatewayWalletId: null },
    });
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(0),
      makeAudit(),
    );

    await expect(
      service.initiateDeposit(user, 'event-1', { amount: 500 }),
    ).rejects.toThrow(/phone number/i);
  });

  it('redirects via the org subaccount with zero fee for a Kenya deposit', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'redirect',
      authorizationUrl: 'https://paystack.test/pay',
      reference: 'ref-1',
    });
    const providers = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrismaForEvent({
      id: 'event-1',
      gatewayWalletId: 'ACCT_123',
      organization: { country: 'KE', gatewayWalletId: null },
    });
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(1.5),
      makeAudit(),
    );

    await service.initiateDeposit(user, 'event-1', {
      amount: 1000,
      paymentMethod: 'card',
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        subaccountCode: 'ACCT_123',
        channels: ['card'],
        metadata: { eventId: 'event-1', platformFeeAmount: 0 },
      }),
    );
  });

  it('rejects when the event does not exist', async () => {
    const providers = {
      forCountry: jest.fn(),
    } as unknown as PaymentProviderRegistry;
    const prisma = makePrismaForEvent(null);
    const service = new PaymentsService(
      prisma,
      providers,
      makeConfig(0),
      makeAudit(),
    );

    await expect(
      service.initiateDeposit(user, 'missing-event', { amount: 500 }),
    ).rejects.toThrow('Event not found');
  });
});
