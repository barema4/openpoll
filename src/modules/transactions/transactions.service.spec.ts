import { TransactionsService } from './transactions.service';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';

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
    const service = new TransactionsService(prisma, audit);

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
