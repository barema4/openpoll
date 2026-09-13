import { resolveEffectivePlatformRole } from './resolve-effective-platform-role.util';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { ConfigService } from '@nestjs/config';

function makeConfig(operatorEmail: string | undefined) {
  return {
    get: jest.fn().mockReturnValue(operatorEmail),
  } as unknown as ConfigService;
}

describe('resolveEffectivePlatformRole', () => {
  it('returns the DB role when one is set, regardless of email', () => {
    const role = resolveEffectivePlatformRole(
      { email: 'staff@example.com', platformRole: PlatformRole.STAFF },
      makeConfig('owner@example.com'),
    );

    expect(role).toBe(PlatformRole.STAFF);
  });

  it('falls back to OWNER for the configured operator email when no DB role is set', () => {
    const role = resolveEffectivePlatformRole(
      { email: 'owner@example.com', platformRole: null },
      makeConfig('owner@example.com'),
    );

    expect(role).toBe(PlatformRole.OWNER);
  });

  it('is case-insensitive on the operator email match', () => {
    const role = resolveEffectivePlatformRole(
      { email: 'Owner@Example.com', platformRole: null },
      makeConfig('owner@example.com'),
    );

    expect(role).toBe(PlatformRole.OWNER);
  });

  it('returns null for a regular user with no DB role and a non-matching email', () => {
    const role = resolveEffectivePlatformRole(
      { email: 'nobody@example.com', platformRole: null },
      makeConfig('owner@example.com'),
    );

    expect(role).toBeNull();
  });

  it('returns null when PLATFORM_OPERATOR_EMAIL is unset and no DB role is set', () => {
    const role = resolveEffectivePlatformRole(
      { email: 'anyone@example.com', platformRole: null },
      makeConfig(undefined),
    );

    expect(role).toBeNull();
  });
});
