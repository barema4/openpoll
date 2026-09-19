import { BadRequestException } from '@nestjs/common';
import { DisbursementsService } from './disbursements.service';
import {
  BudgetApprovalStatus,
  DisbursementStatus,
  OrganizationCountry,
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
        organization: { country: OrganizationCountry.UGANDA },
        budgetApproval: { status: BudgetApprovalStatus.FUNDED },
      },
      ...overrides,
    };
  }

  function makeService(opts: {
    category: ReturnType<typeof makeCategory>;
    alreadyPaid?: number | null;
    payoutAccepted?: boolean;
    failureMessage?: string;
  }) {
    const findUniqueOrThrow = jest.fn().mockResolvedValue(opts.category);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { amount: opts.alreadyPaid ?? null } });
    const create = jest.fn().mockResolvedValue({ id: 'disb-1' });
    const update = jest.fn().mockResolvedValue({ id: 'disb-1' });
    const prisma = {
      budgetCategory: { findUniqueOrThrow },
      disbursement: { aggregate, create, update },
    } as unknown as PrismaService;
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const initiatePayout = jest.fn().mockResolvedValue({
      accepted: opts.payoutAccepted ?? true,
      failureMessage: opts.failureMessage,
    });
    const pawapay = { initiatePayout } as unknown as PawaPayProvider;
    const service = new DisbursementsService(prisma, audit, pawapay);
    return { service, create, update, initiatePayout, recordAudit, aggregate };
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
          organization: { country: OrganizationCountry.UGANDA },
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
          organization: { country: OrganizationCountry.KENYA },
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
