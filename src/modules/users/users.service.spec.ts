import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PayoutsService } from '../payouts/payouts.service';
import type { AuditService } from '../../audit/audit.service';

describe('UsersService.setPayout', () => {
  it('onboards the payout with the user name as businessName and persists the result', async () => {
    const onboard = jest.fn().mockResolvedValue({
      gatewayWalletId: 'ACCT_test123',
      payoutBankName: 'Equity Bank',
      payoutAccountName: 'JANE DOE',
      payoutAccountLast4: '6789',
    });
    const payouts = { onboard } as unknown as PayoutsService;
    const update = jest.fn().mockResolvedValue({ id: 'user-1' });
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Jane Doe' }),
        update,
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new UsersService(prisma, payouts, audit);

    await service.setPayout('user-1', {
      bankCode: '011',
      bankName: 'Equity Bank',
      accountNumber: '0123456789',
    });

    expect(onboard).toHaveBeenCalledWith({
      businessName: 'Jane Doe',
      bankCode: '011',
      bankName: 'Equity Bank',
      accountNumber: '0123456789',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: {
          gatewayWalletId: 'ACCT_test123',
          payoutBankName: 'Equity Bank',
          payoutAccountName: 'JANE DOE',
          payoutAccountLast4: '6789',
        },
      }),
    );
  });
});

describe('UsersService.updateProfile', () => {
  it('rejects an email already owned by a different user', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'other-user' }),
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new UsersService(prisma, {} as PayoutsService, audit);

    await expect(
      service.updateProfile('user-1', { email: 'taken@example.com' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('allows keeping your own current email unchanged', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'user-1' });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
        update,
      },
    } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const service = new UsersService(prisma, {} as PayoutsService, audit);

    await service.updateProfile('user-1', {
      name: 'Jane D.',
      email: 'jane@example.com',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { name: 'Jane D.', email: 'jane@example.com' },
      }),
    );
  });
});

describe('UsersService.changePassword', () => {
  it('rejects an incorrect current password', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ passwordHash: await bcrypt.hash('correct', 4) }),
      },
    } as unknown as PrismaService;
    const auditRecord = jest.fn();
    const audit = { record: auditRecord } as unknown as AuditService;
    const service = new UsersService(prisma, {} as PayoutsService, audit);

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'wrong',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow(/incorrect/i);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('updates the password and records an audit entry on success', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ passwordHash: await bcrypt.hash('correct', 4) }),
        update,
      },
    } as unknown as PrismaService;
    const auditRecord = jest.fn();
    const audit = { record: auditRecord } as unknown as AuditService;
    const service = new UsersService(prisma, {} as PayoutsService, audit);

    const result = await service.changePassword('user-1', {
      currentPassword: 'correct',
      newPassword: 'newpassword123',
    });

    expect(result.message).toMatch(/changed successfully/i);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PASSWORD_CHANGED' }),
    );
  });
});
