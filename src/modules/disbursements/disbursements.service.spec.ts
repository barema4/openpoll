import { BadRequestException, ConflictException } from '@nestjs/common';
import { DisbursementsService } from './disbursements.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  BudgetApprovalStatus,
  DisbursementStatus,
  VendorPayoutMethod,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { PawaPayProvider } from '../payments/providers/pawapay.provider';

describe('DisbursementsService.pay', () => {
  function makeCategory(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cat-1',
      eventId: 'event-1',
      allocatedFunds: '500',
      vendor: {
        id: 'vendor-1',
        name: 'Acme Catering',
        payoutMethod: VendorPayoutMethod.MOBILE_MONEY,
        payoutMobileProvider: 'MTN_MOMO_UGA',
        payoutMobileNumber: '256771234567',
      },
      event: {
        organization: { country: 'UG' },
        budgetApproval: { status: BudgetApprovalStatus.FUNDED },
      },
      ...overrides,
    };
  }

  // reserveDisbursement() runs everything inside prisma.$transaction — the
  // mock invokes the callback with a `tx` exposing the same model methods,
  // matching how the real Prisma client behaves for an interactive
  // transaction. disbursement.update (the post-payout status flip) happens
  // outside the transaction, so it stays on the top-level prisma mock.
  function makeService(opts: {
    category: ReturnType<typeof makeCategory>;
    alreadyPaid?: number | null;
    eventReceived?: number | null;
    payoutAccepted?: boolean;
    failureMessage?: string;
    transactionError?: Error;
  }) {
    const findUniqueOrThrow = jest.fn().mockResolvedValue(opts.category);
    const disbursementAggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { amount: opts.alreadyPaid ?? null } });
    const transactionAggregate = jest.fn().mockResolvedValue({
      _sum: { amountSettled: opts.eventReceived ?? 100000 },
    });
    const create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'disb-1', ...args.data }),
    );
    const tx = {
      budgetCategory: { findUniqueOrThrow },
      disbursement: { aggregate: disbursementAggregate, create },
      transaction: { aggregate: transactionAggregate },
    };
    const $transaction = opts.transactionError
      ? jest.fn().mockRejectedValue(opts.transactionError)
      : jest.fn((cb: (tx: unknown) => unknown) => cb(tx));
    const update = jest.fn().mockResolvedValue({ id: 'disb-1' });
    const prisma = {
      $transaction,
      disbursement: { update },
    } as unknown as PrismaService;
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const initiatePayout = jest.fn().mockResolvedValue({
      accepted: opts.payoutAccepted ?? true,
      failureMessage: opts.failureMessage,
    });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new DisbursementsService(prisma, audit, pawapay);
    return {
      service,
      create,
      update,
      initiatePayout,
      recordAudit,
      disbursementAggregate,
      transactionAggregate,
    };
  }

  it('pays the full remaining allocated balance to a Uganda mobile-money vendor', async () => {
    const { service, create, update, initiatePayout } = makeService({
      category: makeCategory(),
      alreadyPaid: 0,
    });

    await service.pay('user-1', 'cat-1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: 'event-1',
          budgetCategoryId: 'cat-1',
          vendorId: 'vendor-1',
          recipientName: 'Acme Catering',
          recipientMobileProvider: 'MTN_MOMO_UGA',
          recipientMobileNumber: '256771234567',
          amount: 500,
        }) as unknown,
      }),
    );
    expect(initiatePayout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        currency: 'UGX',
        phoneNumber: '256771234567',
        provider: 'MTN_MOMO_UGA',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DisbursementStatus.QUEUED,
          gatewayTransferRef: expect.any(String) as unknown,
        }) as unknown,
      }),
    );
  });

  it('pays only what is left after previous disbursements against the category', async () => {
    const { service, create } = makeService({
      category: makeCategory(),
      alreadyPaid: 300,
    });

    await service.pay('user-1', 'cat-1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 200 }) as unknown,
      }),
    );
  });

  it('rejects when the category has already been fully paid', async () => {
    const { service } = makeService({
      category: makeCategory(),
      alreadyPaid: 500,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects when the event's budget is not FUNDED", async () => {
    const { service } = makeService({
      category: makeCategory({
        event: {
          organization: { country: 'UG' },
          budgetApproval: { status: BudgetApprovalStatus.APPROVED },
        },
      }),
      alreadyPaid: 0,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when the category has no vendor assigned', async () => {
    const { service } = makeService({
      category: makeCategory({ vendor: null }),
      alreadyPaid: 0,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a Kenya bank-account vendor — not available until the Paystack Transfer integration lands', async () => {
    const { service } = makeService({
      category: makeCategory({
        vendor: {
          id: 'vendor-2',
          name: 'Nairobi Sound Co',
          payoutMethod: VendorPayoutMethod.BANK_ACCOUNT,
          payoutMobileProvider: null,
          payoutMobileNumber: null,
        },
        event: {
          organization: { country: 'KE' },
          budgetApproval: { status: BudgetApprovalStatus.FUNDED },
        },
      }),
      alreadyPaid: 0,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('marks the disbursement FAILED when the provider rejects the payout', async () => {
    const { service, update } = makeService({
      category: makeCategory(),
      alreadyPaid: 0,
      payoutAccepted: false,
      failureMessage: 'insufficient platform balance',
    });

    await service.pay('user-1', 'cat-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DisbursementStatus.FAILED,
          failureReason: 'insufficient platform balance',
        }) as unknown,
      }),
    );
  });

  it('rejects when the event no longer really holds the allocated amount (e.g. a refund happened after allocation)', async () => {
    const { service } = makeService({
      category: makeCategory(),
      alreadyPaid: 0,
      // The category shows 500 allocated, but the event's real, current
      // pool (non-manual SUCCESS transactions minus what's already
      // disbursed) is only 200 — allocatedFunds is stale relative to a
      // refund that happened after allocation.
      eventReceived: 200,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toThrow(
      /actually still holds/i,
    );
  });

  it('rejects with a 409 when a concurrent Pay request wins the race (Postgres serialization failure)', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const { service } = makeService({
      category: makeCategory(),
      alreadyPaid: 0,
      transactionError: conflict,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects with a 409 for the real DriverAdapterError shape @prisma/adapter-pg actually throws on conflict', async () => {
    const conflict = new Error('TransactionWriteConflict');
    conflict.name = 'DriverAdapterError';
    (conflict as unknown as { cause: { kind: string } }).cause = {
      kind: 'TransactionWriteConflict',
    };
    const { service } = makeService({
      category: makeCategory(),
      alreadyPaid: 0,
      transactionError: conflict,
    });

    await expect(service.pay('user-1', 'cat-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('DisbursementsService.listForEvent', () => {
  it('paginates and never selects raw recipient account/phone fields', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'disb-1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      disbursement: { findMany, count },
    } as unknown as PrismaService;
    const audit = {} as unknown as AuditService;
    const pawapay = {} as unknown as PawaPayProvider;
    const service = new DisbursementsService(prisma, audit, pawapay);

    const result = await service.listForEvent({ eventId: 'event-1' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'event-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      }),
    );
    const select = (
      findMany.mock.calls[0][0] as { select: Record<string, boolean> }
    ).select;
    expect(select.recipientAccountNumber).toBeUndefined();
    expect(select.recipientMobileNumber).toBeUndefined();
    expect(result).toEqual({
      data: [{ id: 'disb-1' }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });
});
