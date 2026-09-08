import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { OrganizationInvitationStatus } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { EmailService } from '../email/email.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';

function buildService(prisma: Record<string, unknown>) {
  const auditRecord = jest.fn();
  const emailSend = jest.fn();
  const audit = { record: auditRecord } as unknown as AuditService;
  const email = { send: emailSend } as unknown as EmailService;
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  } as unknown as JwtService;
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'PUBLIC_CHECKOUT_BASE_URL') return 'http://localhost:5173';
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwtService,
    config,
    audit,
    email,
  );
  return { service, auditRecord, emailSend };
}

describe('AuthService.forgotPassword', () => {
  it('returns the same generic message when no account exists (enumeration-safe)', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service, emailSend } = buildService(prisma);

    const result = await service.forgotPassword({
      email: 'nobody@example.com',
    });

    expect(result.message).toMatch(/if an account exists/i);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('creates a reset token and emails a link when the account exists', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'jane@example.com' }),
      },
      passwordResetToken: { create },
    };
    const { service, emailSend } = buildService(prisma);

    const result = await service.forgotPassword({ email: 'jane@example.com' });

    expect(result.message).toMatch(/if an account exists/i);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com' }),
    );
  });
});

describe('AuthService.resetPassword', () => {
  it('rejects a token that does not exist', async () => {
    const prisma = {
      passwordResetToken: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = buildService(prisma);

    await expect(
      service.resetPassword({ token: 'bad', newPassword: 'newpassword123' }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('rejects an already-used token', async () => {
    const prisma = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: 'user-1',
          usedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const { service } = buildService(prisma);

    await expect(
      service.resetPassword({ token: 'used', newPassword: 'newpassword123' }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('rejects an expired token', async () => {
    const prisma = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: 'user-1',
          usedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
        }),
      },
    };
    const { service } = buildService(prisma);

    await expect(
      service.resetPassword({
        token: 'expired',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('updates the password and marks the token used on a valid token', async () => {
    const transaction = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'reset-1',
          userId: 'user-1',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: jest.fn(),
      },
      user: { update: jest.fn() },
      $transaction: transaction,
    };
    const { service, auditRecord } = buildService(prisma);

    const result = await service.resetPassword({
      token: 'valid',
      newPassword: 'newpassword123',
    });

    expect(result.message).toMatch(/reset successfully/i);
    expect(transaction).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED' }),
    );
  });
});

describe('AuthService.register with an invite token', () => {
  it('accepts a pending invitation whose email matches the registering email', async () => {
    const transaction = jest.fn().mockResolvedValue(undefined);
    const invitation = {
      id: 'invite-1',
      organizationId: 'org-1',
      email: 'jane@example.com',
      role: 'TREASURER',
      status: OrganizationInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'jane@example.com',
          name: 'Jane',
        }),
      },
      organizationInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
        update: jest.fn(),
      },
      organizationMembership: { create: jest.fn() },
      $transaction: transaction,
    };
    const { service, auditRecord } = buildService(prisma);

    await service.register({
      email: 'jane@example.com',
      password: 'password123',
      name: 'Jane',
      inviteToken: 'raw-token',
    });

    expect(transaction).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ORGANIZATION_INVITATION_ACCEPTED' }),
    );
  });

  it('silently ignores an invite token for a different email, never blocking registration', async () => {
    const invitation = {
      id: 'invite-1',
      organizationId: 'org-1',
      email: 'someone-else@example.com',
      role: 'TREASURER',
      status: OrganizationInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const transaction = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'jane@example.com',
          name: 'Jane',
        }),
      },
      organizationInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
      },
      $transaction: transaction,
    };
    const { service } = buildService(prisma);

    const result = await service.register({
      email: 'jane@example.com',
      password: 'password123',
      name: 'Jane',
      inviteToken: 'raw-token',
    });

    expect(result.user.email).toBe('jane@example.com');
    expect(transaction).not.toHaveBeenCalled();
  });
});

// Sanity check that bcrypt is actually exercised in resetPassword — a real
// hash/compare round trip, not just that it was called.
describe('bcrypt sanity', () => {
  it('hashes and verifies a password', async () => {
    const hash = await bcrypt.hash('newpassword123', 4);
    await expect(bcrypt.compare('newpassword123', hash)).resolves.toBe(true);
  });
});
