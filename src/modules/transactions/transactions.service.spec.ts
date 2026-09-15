import { BadRequestException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import {
  DisputeStatus,
  InvoiceStatus,
  OrgRole,
  PaymentRail,
  RefundStatus,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { EmailService } from '../../email/email.service';
import type {
  ParsedDisputeWebhookEvent,
  PaystackProvider,
} from '../payments/providers/paystack.provider';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

const paystack = {} as unknown as PaystackProvider;
const pawapay = {} as unknown as PawaPayProvider;
const email = { send: jest.fn() } as unknown as EmailService;

describe('TransactionsService.recordManual', () => {
  it('creates a SUCCESS transaction tagged paymentRail: MANUAL and audit-logs it', async () => {
    const createFn = jest.fn().mockResolvedValue({
      id: 'txn-1',
      eventId: 'event-1',
      amountSettled: 5000,
    });
    const prisma = {
      transaction: { create: createFn },
    } as unknown as PrismaService;
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    const result = await service.recordManual('user-1', {
      eventId: 'event-1',
      amount: 5000,
      note: 'Cash offering, Sunday service',
    });

    expect(createFn).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: 'event-1',
        paymentRail: PaymentRail.MANUAL,
        status: TransactionStatus.SUCCESS,
        amountSettled: 5000,
        recordedByUserId: 'user-1',
        note: 'Cash offering, Sunday service',
      }) as unknown,
    });
    expect(recordAudit).toHaveBeenCalledWith({
      userId: 'user-1',
      eventId: 'event-1',
      action: 'MANUAL_CONTRIBUTION_RECORDED',
      payload: {
        transactionId: 'txn-1',
        amount: 5000,
        note: 'Cash offering, Sunday service',
      },
    });
    expect(result).toEqual({
      id: 'txn-1',
      eventId: 'event-1',
      amountSettled: 5000,
    });
  });
});

describe('TransactionsService.getReceipt', () => {
  it('breaks out the platform fee and the total actually charged', async () => {
    const prisma = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          providerReference: 'ref-1',
          amountSettled: 1000,
          platformFeeAmount: 15,
          paymentRail: PaymentRail.CARD,
          status: TransactionStatus.SUCCESS,
          timestamp: new Date(),
          invoice: null,
          event: { id: 'event-1', title: 'Wedding', organization: null },
        }),
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    const receipt = await service.getReceipt('ref-1');

    expect(receipt.amountPaid).toBe(1000);
    expect(receipt.platformFeeAmount).toBe(15);
    expect(receipt.totalCharged).toBe(1015);
  });
});

describe('TransactionsService.refund', () => {
  function makeTransaction(overrides: Record<string, unknown> = {}) {
    return {
      id: 'txn-1',
      eventId: 'event-1',
      providerReference: 'ref-1',
      paymentRail: PaymentRail.CARD,
      amountSettled: '1000',
      platformFeeAmount: '15',
      status: TransactionStatus.SUCCESS,
      event: { organization: { country: 'KENYA' } },
      ...overrides,
    };
  }

  it('initiates a Paystack refund for a Kenya transaction and stores it PROCESSING', async () => {
    const transaction = makeTransaction();
    const refundUpsert = jest.fn().mockResolvedValue({ id: 'refund-1' });
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: refundUpsert,
      },
    } as unknown as PrismaService;
    const initiateRefund = jest
      .fn()
      .mockResolvedValue({ refundReference: 'ps_refund_1', accepted: true });
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      { initiateRefund } as unknown as PaystackProvider,
      pawapay,
      email,
    );

    await service.refund('user-1', 'txn-1');

    expect(initiateRefund).toHaveBeenCalledWith({
      transactionReference: 'ref-1',
    });
    expect(refundUpsert).toHaveBeenCalledWith({
      where: { transactionId: 'txn-1' },
      create: expect.objectContaining({
        transactionId: 'txn-1',
        amount: 1015,
        status: RefundStatus.PROCESSING,
        providerReference: 'ps_refund_1',
        requestedByUserId: 'user-1',
      }) as unknown,
      update: expect.objectContaining({
        amount: 1015,
        status: RefundStatus.PROCESSING,
        providerReference: 'ps_refund_1',
      }) as unknown,
    });
  });

  it('initiates a PawaPay refund for a Uganda transaction with the gross amount in UGX', async () => {
    const transaction = makeTransaction({
      event: { organization: { country: 'UGANDA' } },
    });
    const refundUpsert = jest.fn().mockResolvedValue({ id: 'refund-1' });
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: refundUpsert,
      },
    } as unknown as PrismaService;
    const initiateRefund = jest.fn().mockResolvedValue({ accepted: true });
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      { initiateRefund } as unknown as PawaPayProvider,
      email,
    );

    await service.refund('user-1', 'txn-1');

    expect(initiateRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        depositId: 'ref-1',
        amount: 1015,
        currency: 'UGX',
      }),
    );
    expect(refundUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transactionId: 'txn-1' },
        create: expect.objectContaining({
          amount: 1015,
          status: RefundStatus.PROCESSING,
        }) as unknown,
      }),
    );
  });

  it('retries after a prior FAILED refund by reusing the same row (upsert), not rejecting', async () => {
    const transaction = makeTransaction();
    const refundUpsert = jest.fn().mockResolvedValue({ id: 'refund-1' });
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refund-1',
          status: RefundStatus.FAILED,
        }),
        upsert: refundUpsert,
      },
    } as unknown as PrismaService;
    const initiateRefund = jest
      .fn()
      .mockResolvedValue({ refundReference: 'ps_refund_2', accepted: true });
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      { initiateRefund } as unknown as PaystackProvider,
      pawapay,
      email,
    );

    await service.refund('user-1', 'txn-1');

    expect(refundUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transactionId: 'txn-1' },
        update: expect.objectContaining({
          status: RefundStatus.PROCESSING,
        }) as unknown,
      }),
    );
  });

  it('rejects refunding a transaction that never succeeded', async () => {
    const transaction = makeTransaction({ status: TransactionStatus.FAILED });
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await expect(service.refund('user-1', 'txn-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects refunding a manually recorded (off-app) contribution', async () => {
    const transaction = makeTransaction({ paymentRail: PaymentRail.MANUAL });
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await expect(service.refund('user-1', 'txn-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a transaction that already has a refund', async () => {
    const transaction = makeTransaction();
    const prisma = {
      transaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(transaction),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'existing-refund',
          status: RefundStatus.COMPLETED,
        }),
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await expect(service.refund('user-1', 'txn-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('TransactionsService.completeRefund', () => {
  function makeRefund(overrides: Record<string, unknown> = {}) {
    return {
      id: 'refund-1',
      transactionId: 'txn-1',
      status: RefundStatus.PROCESSING,
      transaction: {
        id: 'txn-1',
        eventId: 'event-1',
        amountSettled: '500',
        invoice: {
          id: 'inv-1',
          amountPaid: '1200',
          amountRequested: '1500',
          expiresAt: new Date(Date.now() + 60_000),
          status: InvoiceStatus.PARTIALLY_PAID,
        },
      },
      ...overrides,
    };
  }

  function makePrisma(refund: unknown) {
    const tx = {
      refund: { update: jest.fn() },
      transaction: { update: jest.fn() },
      invoice: { update: jest.fn() },
    };
    const prisma = {
      refund: { findUnique: jest.fn().mockResolvedValue(refund) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { prisma, tx };
  }

  it('flips the transaction to REFUNDED and decrements a single-use invoice amountPaid on success', async () => {
    const refund = makeRefund();
    const { prisma, tx } = makePrisma(refund);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('ps_refund_1', true);

    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { status: TransactionStatus.REFUNDED },
    });
    // 1200 - 500 = 700, still short of the 1500 target.
    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { amountPaid: 700, status: InvoiceStatus.PARTIALLY_PAID },
    });
  });

  it('recomputes PENDING when a refund brings amountPaid back to zero', async () => {
    const refund = makeRefund({
      transaction: {
        id: 'txn-1',
        eventId: 'event-1',
        amountSettled: '500',
        invoice: {
          id: 'inv-1',
          amountPaid: '500',
          amountRequested: '1500',
          expiresAt: new Date(Date.now() + 60_000),
          status: InvoiceStatus.PARTIALLY_PAID,
        },
      },
    });
    const { prisma, tx } = makePrisma(refund);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('ps_refund_1', true);

    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { amountPaid: 0, status: InvoiceStatus.PENDING },
    });
  });

  it('does not touch invoice bookkeeping for a permanent-link transaction (no invoice)', async () => {
    const refund = makeRefund({
      transaction: {
        id: 'txn-1',
        eventId: 'event-1',
        amountSettled: '500',
        invoice: null,
      },
    });
    const { prisma, tx } = makePrisma(refund);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('ps_refund_1', true);

    expect(tx.transaction.update).toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
  });

  it('marks the refund FAILED without touching the transaction when the callback reports failure', async () => {
    const refund = makeRefund();
    const { prisma, tx } = makePrisma(refund);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('ps_refund_1', false, 'insufficient balance');

    expect(tx.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RefundStatus.FAILED,
          failureReason: 'insufficient balance',
        }) as unknown,
      }),
    );
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown providerReference', async () => {
    const { prisma, tx } = makePrisma(null);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('unknown-ref', true);

    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it('is a no-op (idempotent) when the refund is already COMPLETED', async () => {
    const refund = makeRefund({ status: RefundStatus.COMPLETED });
    const { prisma, tx } = makePrisma(refund);
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new TransactionsService(
      prisma,
      audit,
      paystack,
      pawapay,
      email,
    );

    await service.completeRefund('ps_refund_1', true);

    expect(tx.transaction.update).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.handleDisputeEvent', () => {
  function makeEvent(
    overrides: Partial<ParsedDisputeWebhookEvent> = {},
  ): ParsedDisputeWebhookEvent {
    return {
      providerReference: 'dispute-1',
      transactionReference: 'ref-1',
      status: DisputeStatus.AWAITING_MERCHANT_FEEDBACK,
      resolution: null,
      amount: 1000,
      reason: null,
      ...overrides,
    };
  }

  function makeTransactionRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'txn-1',
      eventId: 'event-1',
      status: TransactionStatus.SUCCESS,
      amountSettled: '1000',
      invoice: null,
      event: { organizationId: 'org-1', title: 'Wedding' },
      ...overrides,
    };
  }

  function makePrisma(opts: {
    existingDispute?: unknown;
    transaction?: unknown;
    admins?: unknown[];
  }) {
    const disputeUpsert = jest.fn().mockResolvedValue({ id: 'dispute-row-1' });
    const membershipFindMany = jest.fn().mockResolvedValue(opts.admins ?? []);
    const txUpdate = jest.fn();
    const invoiceUpdate = jest.fn();
    const tx = {
      transaction: { update: txUpdate },
      invoice: { update: invoiceUpdate },
    };
    const prisma = {
      dispute: {
        findUnique: jest.fn().mockResolvedValue(opts.existingDispute ?? null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'dispute-row-1',
          amount: '1000',
          transaction: makeTransactionRecord(),
        }),
        upsert: disputeUpsert,
      },
      transaction: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.transaction ?? makeTransactionRecord()),
      },
      organizationMembership: { findMany: membershipFindMany },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return {
      prisma,
      disputeUpsert,
      membershipFindMany,
      txUpdate,
      invoiceUpdate,
    };
  }

  it('records a new dispute, audits it, and emails the org MAIN_ORGANIZER/TREASURER admins', async () => {
    const admins = [
      { user: { email: 'owner@example.com' } },
      { user: { email: 'treasurer@example.com' } },
    ];
    const { prisma, membershipFindMany } = makePrisma({ admins });
    const emailSend = jest.fn();
    const recordAudit = jest.fn();
    const service = new TransactionsService(
      prisma,
      { record: recordAudit } as unknown as AuditService,
      paystack,
      pawapay,
      { send: emailSend } as unknown as EmailService,
    );

    await service.handleDisputeEvent(makeEvent());

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISPUTE_OPENED' }),
    );
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          role: { in: [OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER] },
        }) as unknown,
      }),
    );
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com' }),
    );
  });

  it('does not re-notify or re-audit-open a dispute that already exists (redelivered create/reminder)', async () => {
    const { prisma } = makePrisma({
      existingDispute: { id: 'dispute-row-1' },
    });
    const emailSend = jest.fn();
    const recordAudit = jest.fn();
    const service = new TransactionsService(
      prisma,
      { record: recordAudit } as unknown as AuditService,
      paystack,
      pawapay,
      { send: emailSend } as unknown as EmailService,
    );

    await service.handleDisputeEvent(makeEvent());

    expect(emailSend).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISPUTE_OPENED' }),
    );
  });

  it('reverses the transaction when a dispute resolves as merchant-accepted (lost)', async () => {
    const { prisma, txUpdate } = makePrisma({
      existingDispute: { id: 'dispute-row-1' },
    });
    const recordAudit = jest.fn();
    const service = new TransactionsService(
      prisma,
      { record: recordAudit } as unknown as AuditService,
      paystack,
      pawapay,
      email,
    );

    await service.handleDisputeEvent(
      makeEvent({
        status: DisputeStatus.RESOLVED,
        resolution: 'merchant-accepted',
      }),
    );

    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'txn-1' },
      data: { status: TransactionStatus.REFUNDED },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISPUTE_LOST' }),
    );
  });

  it('does not reverse anything when a dispute resolves as declined (won)', async () => {
    const { prisma, txUpdate } = makePrisma({
      existingDispute: { id: 'dispute-row-1' },
    });
    const recordAudit = jest.fn();
    const service = new TransactionsService(
      prisma,
      { record: recordAudit } as unknown as AuditService,
      paystack,
      pawapay,
      email,
    );

    await service.handleDisputeEvent(
      makeEvent({ status: DisputeStatus.RESOLVED, resolution: 'declined' }),
    );

    expect(txUpdate).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISPUTE_RESOLVED' }),
    );
  });

  it('does not double-reverse a transaction that was already refunded through another path', async () => {
    const { prisma, txUpdate } = makePrisma({
      existingDispute: { id: 'dispute-row-1' },
      transaction: makeTransactionRecord({
        status: TransactionStatus.REFUNDED,
      }),
    });
    const service = new TransactionsService(
      prisma,
      { record: jest.fn() } as unknown as AuditService,
      paystack,
      pawapay,
      email,
    );

    await service.handleDisputeEvent(
      makeEvent({
        status: DisputeStatus.RESOLVED,
        resolution: 'merchant-accepted',
      }),
    );

    expect(txUpdate).not.toHaveBeenCalled();
  });
});

describe('TransactionsService.listForEvent', () => {
  function makeService(findMany: jest.Mock, count: jest.Mock) {
    const prisma = {
      transaction: { findMany, count },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    return new TransactionsService(prisma, audit, paystack, pawapay, email);
  }

  it('paginates with the default page/pageSize and returns the envelope shape', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'txn-1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = makeService(findMany, count);

    const result = await service.listForEvent({ eventId: 'event-1' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'event-1' },
        skip: 0,
        take: 10,
        orderBy: { timestamp: 'desc' },
      }),
    );
    expect(result).toEqual({
      data: [{ id: 'txn-1' }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });

  it('computes skip from page and pageSize', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.listForEvent({ eventId: 'event-1', page: 3, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('filters by status, paymentRail, and date range', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.listForEvent({
      eventId: 'event-1',
      status: TransactionStatus.SUCCESS,
      paymentRail: PaymentRail.MOBILE_MONEY,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    const where = (
      findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where).toEqual(
      expect.objectContaining({
        eventId: 'event-1',
        status: TransactionStatus.SUCCESS,
        paymentRail: PaymentRail.MOBILE_MONEY,
        timestamp: {
          gte: new Date('2026-01-01'),
          lt: new Date('2026-02-01'),
        },
      }),
    );
  });

  it('searches provider reference, note, and the linked invoice contributor name', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = makeService(findMany, count);

    await service.listForEvent({ eventId: 'event-1', search: 'jane' });

    const where = (findMany.mock.calls[0][0] as { where: { OR: unknown[] } })
      .where;
    expect(where.OR).toEqual([
      { providerReference: { contains: 'jane', mode: 'insensitive' } },
      { note: { contains: 'jane', mode: 'insensitive' } },
      {
        invoice: { contributorName: { contains: 'jane', mode: 'insensitive' } },
      },
    ]);
  });
});
