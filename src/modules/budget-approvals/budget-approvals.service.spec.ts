import { BadRequestException } from '@nestjs/common';
import { BudgetApprovalsService } from './budget-approvals.service';
import { BudgetApprovalStatus } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

describe('BudgetApprovalsService.getStatus', () => {
  const audit = { record: jest.fn() } as unknown as AuditService;

  it('returns the existing row when one exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      eventId: 'event-1',
      status: BudgetApprovalStatus.APPROVED,
    });
    const create = jest.fn();
    const prisma = {
      budgetApproval: { findUnique, create },
    } as unknown as PrismaService;
    const service = new BudgetApprovalsService(prisma, audit);

    const result = await service.getStatus('event-1');

    expect(create).not.toHaveBeenCalled();
    expect(result.status).toBe(BudgetApprovalStatus.APPROVED);
  });

  it('lazily creates a DRAFT row when none exists yet', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({
      eventId: 'event-1',
      status: BudgetApprovalStatus.DRAFT,
    });
    const prisma = {
      budgetApproval: { findUnique, create },
    } as unknown as PrismaService;
    const service = new BudgetApprovalsService(prisma, audit);

    const result = await service.getStatus('event-1');

    expect(create).toHaveBeenCalledWith({ data: { eventId: 'event-1' } });
    expect(result.status).toBe(BudgetApprovalStatus.DRAFT);
  });
});

describe('BudgetApprovalsService.submit', () => {
  function makePrisma(opts: {
    status?: BudgetApprovalStatus;
    totalAllocated?: number | null;
  }) {
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        opts.status ? { eventId: 'event-1', status: opts.status } : null,
      );
    const create = jest.fn().mockResolvedValue({
      eventId: 'event-1',
      status: BudgetApprovalStatus.DRAFT,
    });
    const update = jest.fn().mockResolvedValue({
      eventId: 'event-1',
      status: BudgetApprovalStatus.SUBMITTED,
    });
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { allocatedFunds: opts.totalAllocated ?? null },
    });
    const prisma = {
      budgetApproval: { findUnique, create, update },
      budgetCategory: { aggregate },
    } as unknown as PrismaService;
    return { prisma, update, aggregate };
  }

  it('submits a DRAFT budget with at least one funded category', async () => {
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const { prisma, update } = makePrisma({
      status: BudgetApprovalStatus.DRAFT,
      totalAllocated: 500,
    });
    const service = new BudgetApprovalsService(prisma, audit);

    await service.submit('user-1', 'event-1');

    expect(update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: expect.objectContaining({
        status: BudgetApprovalStatus.SUBMITTED,
        submittedByUserId: 'user-1',
      }) as unknown,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BUDGET_SUBMITTED' }),
    );
  });

  it('rejects submitting with nothing allocated', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma } = makePrisma({
      status: BudgetApprovalStatus.DRAFT,
      totalAllocated: 0,
    });
    const service = new BudgetApprovalsService(prisma, audit);

    await expect(service.submit('user-1', 'event-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects re-submitting a budget that is already SUBMITTED', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma } = makePrisma({
      status: BudgetApprovalStatus.SUBMITTED,
      totalAllocated: 500,
    });
    const service = new BudgetApprovalsService(prisma, audit);

    await expect(service.submit('user-1', 'event-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows resubmitting a DECLINED budget', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma, update } = makePrisma({
      status: BudgetApprovalStatus.DECLINED,
      totalAllocated: 500,
    });
    const service = new BudgetApprovalsService(prisma, audit);

    await service.submit('user-1', 'event-1');

    expect(update).toHaveBeenCalled();
  });
});

describe('BudgetApprovalsService.decide', () => {
  function makePrisma(status: BudgetApprovalStatus) {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ eventId: 'event-1', status });
    const update = jest.fn().mockResolvedValue({ eventId: 'event-1' });
    const prisma = {
      budgetApproval: { findUnique, update },
    } as unknown as PrismaService;
    return { prisma, update };
  }

  it('approves a SUBMITTED budget', async () => {
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const { prisma, update } = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetApprovalsService(prisma, audit);

    await service.decide('treasurer-1', 'event-1', { approve: true });

    expect(update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: expect.objectContaining({
        status: BudgetApprovalStatus.APPROVED,
        decidedByUserId: 'treasurer-1',
        declineReason: null,
      }) as unknown,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BUDGET_APPROVED' }),
    );
  });

  it('declines a SUBMITTED budget with a reason', async () => {
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const { prisma, update } = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetApprovalsService(prisma, audit);

    await service.decide('treasurer-1', 'event-1', {
      approve: false,
      reason: 'Catering line is over market rate',
    });

    expect(update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: expect.objectContaining({
        status: BudgetApprovalStatus.DECLINED,
        declineReason: 'Catering line is over market rate',
      }) as unknown,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BUDGET_DECLINED' }),
    );
  });

  it('rejects declining without a reason', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma } = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetApprovalsService(prisma, audit);

    await expect(
      service.decide('treasurer-1', 'event-1', { approve: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects deciding a budget that is not SUBMITTED', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma } = makePrisma(BudgetApprovalStatus.DRAFT);
    const service = new BudgetApprovalsService(prisma, audit);

    await expect(
      service.decide('treasurer-1', 'event-1', { approve: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BudgetApprovalsService.fund', () => {
  function makePrisma(status: BudgetApprovalStatus) {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ eventId: 'event-1', status });
    const update = jest.fn().mockResolvedValue({ eventId: 'event-1' });
    const prisma = {
      budgetApproval: { findUnique, update },
    } as unknown as PrismaService;
    return { prisma, update };
  }

  it('funds an APPROVED budget without moving any money', async () => {
    const recordAudit = jest.fn();
    const audit = { record: recordAudit } as unknown as AuditService;
    const { prisma, update } = makePrisma(BudgetApprovalStatus.APPROVED);
    const service = new BudgetApprovalsService(prisma, audit);

    await service.fund('treasurer-1', 'event-1');

    expect(update).toHaveBeenCalledWith({
      where: { eventId: 'event-1' },
      data: expect.objectContaining({
        status: BudgetApprovalStatus.FUNDED,
        fundedByUserId: 'treasurer-1',
      }) as unknown,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BUDGET_FUNDED' }),
    );
  });

  it('rejects funding a budget that is not APPROVED', async () => {
    const audit = { record: jest.fn() } as unknown as AuditService;
    const { prisma } = makePrisma(BudgetApprovalStatus.SUBMITTED);
    const service = new BudgetApprovalsService(prisma, audit);

    await expect(service.fund('treasurer-1', 'event-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
