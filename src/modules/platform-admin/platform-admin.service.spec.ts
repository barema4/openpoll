import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import {
  PlatformRole,
  PlatformStaffInvitationStatus,
} from '../../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { EmailService } from '../../email/email.service';

const audit = { record: jest.fn() } as unknown as AuditService;
const config = {
  get: jest.fn().mockReturnValue('http://localhost:3001'),
} as unknown as ConfigService;

describe('PlatformAdminService.inviteStaff', () => {
  it('grants STAFF directly when the invited email already has an account', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'user-2',
      email: 'bob@example.com',
      platformRole: PlatformRole.STAFF,
    });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-2',
          email: 'bob@example.com',
          platformRole: null,
        }),
        update,
      },
    } as unknown as PrismaService;
    const emailSend = jest.fn();
    const service = new PlatformAdminService(prisma, audit, config, {
      send: emailSend,
    } as unknown as EmailService);

    const result = await service.inviteStaff('owner-1', {
      email: 'bob@example.com',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2' },
        data: { platformRole: PlatformRole.STAFF },
      }),
    );
    expect(emailSend).not.toHaveBeenCalled();
    expect(result).toMatchObject({ platformRole: PlatformRole.STAFF });
  });

  it('rejects inviting someone who already has platform access', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-2',
          email: 'bob@example.com',
          platformRole: PlatformRole.STAFF,
        }),
      },
    } as unknown as PrismaService;
    const service = new PlatformAdminService(prisma, audit, config, {
      send: jest.fn(),
    } as unknown as EmailService);

    await expect(
      service.inviteStaff('owner-1', { email: 'bob@example.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a pending invitation and emails a sign-up link when no account exists yet', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      platformStaffInvitation: { create },
    } as unknown as PrismaService;
    const emailSend = jest.fn();
    const service = new PlatformAdminService(prisma, audit, config, {
      send: emailSend,
    } as unknown as EmailService);

    const result = await service.inviteStaff('owner-1', {
      email: 'new@example.com',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          invitedByUserId: 'owner-1',
        }),
      }),
    );
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        html: expect.stringContaining('/register?staffInvite=') as unknown,
      }),
    );
    expect(result).toEqual({ status: 'invited', email: 'new@example.com' });
  });
});

describe('PlatformAdminService.revokeStaff', () => {
  it('sets platformRole back to null and audit-logs it', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'user-2',
      email: 'bob@example.com',
      platformRole: null,
    });
    const prisma = { user: { update } } as unknown as PrismaService;
    const recordAudit = jest.fn();
    const service = new PlatformAdminService(
      prisma,
      { record: recordAudit } as unknown as AuditService,
      config,
      { send: jest.fn() } as unknown as EmailService,
    );

    const result = await service.revokeStaff('owner-1', 'user-2');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2' },
        data: { platformRole: null },
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_STAFF_REVOKED',
        payload: { revokedUserId: 'user-2' },
      }),
    );
    expect(result.platformRole).toBeNull();
  });
});

describe('PlatformAdminService.getInvitationPreview', () => {
  function makeService(invitation: unknown) {
    const prisma = {
      platformStaffInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
      },
    } as unknown as PrismaService;
    return new PlatformAdminService(prisma, audit, config, {
      send: jest.fn(),
    } as unknown as EmailService);
  }

  it('throws NotFoundException when no invitation matches the token', async () => {
    const service = makeService(null);

    await expect(
      service.getInvitationPreview('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws GoneException for an already-accepted invitation', async () => {
    const service = makeService({
      status: PlatformStaffInvitationStatus.ACCEPTED,
      expiresAt: new Date(Date.now() + 60_000),
      email: 'bob@example.com',
    });

    await expect(service.getInvitationPreview('used')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('throws GoneException for an expired invitation', async () => {
    const service = makeService({
      status: PlatformStaffInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() - 60_000),
      email: 'bob@example.com',
    });

    await expect(
      service.getInvitationPreview('expired'),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('returns the invited email for a valid pending invitation', async () => {
    const service = makeService({
      status: PlatformStaffInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      email: 'bob@example.com',
    });

    await expect(service.getInvitationPreview('valid')).resolves.toEqual({
      email: 'bob@example.com',
    });
  });
});
