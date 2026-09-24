import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PersonalInvoicesService } from './personal-invoices.service';
import { PersonalInvoiceStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { PaymentProviderRegistry } from '../payments/providers/payment-provider.registry';

const auditRecord = jest.fn();
const audit = { record: auditRecord } as unknown as AuditService;
const config = {
  get: jest.fn((key: string) =>
    key === 'PLATFORM_FEE_PERCENT' ? 0 : 'http://localhost:3001',
  ),
} as unknown as ConfigService;
const providers = {
  forCountry: jest.fn().mockReturnValue({
    initializeCharge: jest.fn(),
    parseWebhookEvent: jest.fn(),
    verifyTransaction: jest.fn(),
  }),
} as unknown as PaymentProviderRegistry;

describe('PersonalInvoicesService.create', () => {
  it('persists a personal invoice scoped to the issuer with a secure token and expiry', async () => {
    const created: Record<string, unknown> = {};
    const prisma = {
      personalInvoice: {
        create: jest.fn().mockImplementation(({ data }) => {
          Object.assign(created, { id: 'pi-1', ...data });
          return created;
        }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ country: 'KE' }),
      },
    } as unknown as PrismaService;

    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const result = await service.create('user-1', {
      recipientName: 'Bob',
      recipientEmail: 'bob@example.com',
      amount: 500,
    });

    expect(result.issuerId).toBe('user-1');
    expect(result.recipientName).toBe('Bob');
    expect(typeof result.secureToken).toBe('string');
    expect(result.secureToken.length).toBeGreaterThan(10);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'PERSONAL_INVOICE_CREATED',
      }),
    );
  });

  it('tags the invoice with relatedOrganizationId when the caller is a direct member', async () => {
    const create = jest
      .fn()
      .mockImplementation(({ data }) => ({ id: 'pi-1', ...data }));
    const prisma = {
      personalInvoice: { create },
      organizationMembership: {
        findUnique: jest.fn().mockResolvedValue({ role: 'MAIN_ORGANIZER' }),
      },
      agencyClientAccess: { findUnique: jest.fn() },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ country: 'KE' }),
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const result = await service.create('user-1', {
      recipientName: 'Client Co',
      amount: 500,
      relatedOrganizationId: 'org-1',
    });

    expect(result.relatedOrganizationId).toBe('org-1');
  });

  it('tags the invoice when the caller has agency-granted access instead of a direct membership', async () => {
    const create = jest
      .fn()
      .mockImplementation(({ data }) => ({ id: 'pi-1', ...data }));
    const prisma = {
      personalInvoice: { create },
      organizationMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      agencyClientAccess: {
        findUnique: jest.fn().mockResolvedValue({ role: 'TREASURER' }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ country: 'KE' }),
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const result = await service.create('user-1', {
      recipientName: 'Client Co',
      amount: 500,
      relatedOrganizationId: 'client-org-1',
    });

    expect(result.relatedOrganizationId).toBe('client-org-1');
  });

  it('rejects when the caller has neither a direct membership nor agency access to relatedOrganizationId', async () => {
    const prisma = {
      personalInvoice: { create: jest.fn() },
      organizationMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      agencyClientAccess: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    await expect(
      service.create('user-1', {
        recipientName: 'Client Co',
        amount: 500,
        relatedOrganizationId: 'org-not-mine',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PersonalInvoicesService.listForUser', () => {
  it("lists all of the caller's invoices when no relatedOrganizationId filter is given", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      personalInvoice: { findMany },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    await service.listForUser('user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issuerId: 'user-1' } }),
    );
  });

  it('filters by relatedOrganizationId when given', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      personalInvoice: { findMany },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    await service.listForUser('user-1', 'org-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issuerId: 'user-1', relatedOrganizationId: 'org-1' },
      }),
    );
  });
});

describe('PersonalInvoicesService.findByToken', () => {
  function makeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pi-1',
      secureToken: 'tok-abc',
      status: PersonalInvoiceStatus.PENDING,
      expiresAt: null,
      amount: '500',
      issuer: { id: 'user-1', name: 'Alice', country: 'KE' },
      ...overrides,
    };
  }

  it('throws NotFoundException when no invoice matches the token', async () => {
    const prisma = {
      personalInvoice: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    await expect(service.findByToken('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('flips a past-due PENDING invoice to EXPIRED', async () => {
    const invoice = makeInvoice({ expiresAt: new Date(Date.now() - 1000) });
    const update = jest
      .fn()
      .mockResolvedValue({ ...invoice, status: PersonalInvoiceStatus.EXPIRED });
    const prisma = {
      personalInvoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        update,
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const result = await service.findByToken('tok-abc');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: PersonalInvoiceStatus.EXPIRED },
      }),
    );
    expect(result.status).toBe(PersonalInvoiceStatus.EXPIRED);
  });

  it('leaves a non-expired PENDING invoice untouched', async () => {
    const invoice = makeInvoice({
      expiresAt: new Date(Date.now() + 1000 * 60),
    });
    const update = jest.fn();
    const prisma = {
      personalInvoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        update,
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const result = await service.findByToken('tok-abc');

    expect(update).not.toHaveBeenCalled();
    expect(result.status).toBe(PersonalInvoiceStatus.PENDING);
  });

  it('precomputes the platform fee and total charge off the fixed invoice amount', async () => {
    const invoice = makeInvoice({
      expiresAt: new Date(Date.now() + 1000 * 60),
      amount: '1000',
    });
    const feeConfig = {
      get: jest.fn((key: string) =>
        key === 'PLATFORM_FEE_PERCENT' ? 1.5 : 'http://localhost:3001',
      ),
    } as unknown as ConfigService;
    const prisma = {
      personalInvoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      feeConfig,
      providers,
    );

    const result = await service.findByToken('tok-abc');

    expect(result.platformFeePercent).toBe(1.5);
    expect(result.platformFeeAmount).toBe(15);
    expect(result.totalChargeAmount).toBe(1015);
  });
});

describe('PersonalInvoicesService.initializeCheckout', () => {
  it('charges the gross (base + fee) amount via mobile money and carries the fee in metadata, crediting the issuer with the base amount', async () => {
    const initializeCharge = jest.fn().mockResolvedValue({
      status: 'pending',
      reference: 'ref-1',
    });
    const feeProviders = {
      forCountry: jest.fn().mockReturnValue({ initializeCharge }),
    } as unknown as PaymentProviderRegistry;
    const feeConfig = {
      get: jest.fn((key: string) =>
        key === 'PLATFORM_FEE_PERCENT' ? 1.5 : 'http://localhost:3001',
      ),
    } as unknown as ConfigService;
    const prisma = {
      personalInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pi-1',
          status: PersonalInvoiceStatus.PENDING,
          expiresAt: null,
          amount: '1000',
          issuer: {
            gatewayWalletId: 'ACCT_123',
            country: 'KE',
            payoutMobileProvider: null,
            payoutMobileNumber: null,
          },
        }),
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      feeConfig,
      feeProviders,
    );

    await service.initializeCheckout('tok-abc', {
      payerEmail: 'payer@example.com',
      paymentMethod: 'MPESA_KEN',
      phoneNumber: '254712345678',
    });

    expect(initializeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1015,
        currency: 'KES',
        mobileMoney: { phoneNumber: '254712345678', provider: 'MPESA_KEN' },
        metadata: expect.objectContaining({
          personalInvoiceId: 'pi-1',
          platformFeeAmount: 15,
        }) as unknown,
      }),
    );
  });
});

describe('PersonalInvoicesService.getShareLinks', () => {
  it('builds a checkout URL scoped to /i/:token', async () => {
    const prisma = {
      personalInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pi-1',
          issuerId: 'user-1',
          secureToken: 'tok-abc123',
          recipientName: 'Bob',
          recipientPhone: '+254700000001',
          recipientEmail: 'bob@example.com',
          description: 'April rent',
          amount: '500',
          issuer: { name: 'Alice' },
        }),
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    const links = await service.getShareLinks('pi-1', 'user-1');

    expect(links.checkoutUrl).toBe('http://localhost:3001/i/tok-abc123');
    expect(links.whatsapp.available).toBe(true);
    expect(links.email.available).toBe(true);
  });

  it('throws NotFoundException when the invoice belongs to a different user', async () => {
    const prisma = {
      personalInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pi-1',
          issuerId: 'someone-else',
        }),
      },
    } as unknown as PrismaService;
    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      providers,
    );

    await expect(service.getShareLinks('pi-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
