import { NotFoundException } from '@nestjs/common';
import { PersonalInvoicesService } from './personal-invoices.service';
import { PersonalInvoiceStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { PaymentProvider } from '../payments/providers/payment-provider.interface';

const auditRecord = jest.fn();
const audit = { record: auditRecord } as unknown as AuditService;
const config = {
  get: jest.fn().mockReturnValue('http://localhost:3001'),
} as unknown as ConfigService;
const provider = {
  initializeCharge: jest.fn(),
  verifySignature: jest.fn(),
  parseWebhookEvent: jest.fn(),
  verifyTransaction: jest.fn(),
} as unknown as PaymentProvider;

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
    } as unknown as PrismaService;

    const service = new PersonalInvoicesService(
      prisma,
      audit,
      config,
      provider,
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
});

describe('PersonalInvoicesService.findByToken', () => {
  function makeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pi-1',
      secureToken: 'tok-abc',
      status: PersonalInvoiceStatus.PENDING,
      expiresAt: null,
      issuer: { id: 'user-1', name: 'Alice' },
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
      provider,
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
      provider,
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
      provider,
    );

    const result = await service.findByToken('tok-abc');

    expect(update).not.toHaveBeenCalled();
    expect(result.status).toBe(PersonalInvoiceStatus.PENDING);
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
      provider,
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
      provider,
    );

    await expect(service.getShareLinks('pi-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
