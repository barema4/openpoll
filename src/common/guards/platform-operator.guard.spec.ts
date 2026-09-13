import { ForbiddenException } from '@nestjs/common';
import { PlatformOperatorGuard } from './platform-operator.guard';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

function makeContext(email: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: email ? { id: 'user-1', email } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function makeConfig(operatorEmail: string | undefined) {
  return {
    get: jest.fn().mockReturnValue(operatorEmail),
  } as unknown as ConfigService;
}

describe('PlatformOperatorGuard', () => {
  it('allows the configured operator email', () => {
    const guard = new PlatformOperatorGuard(makeConfig('owner@example.com'));

    expect(guard.canActivate(makeContext('owner@example.com'))).toBe(true);
  });

  it('is case-insensitive', () => {
    const guard = new PlatformOperatorGuard(makeConfig('Owner@Example.com'));

    expect(guard.canActivate(makeContext('owner@example.com'))).toBe(true);
  });

  it('denies any other authenticated user', () => {
    const guard = new PlatformOperatorGuard(makeConfig('owner@example.com'));

    expect(() => guard.canActivate(makeContext('someone-else@example.com'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies everyone when PLATFORM_OPERATOR_EMAIL is unset (fail closed)', () => {
    const guard = new PlatformOperatorGuard(makeConfig(undefined));

    expect(() => guard.canActivate(makeContext('owner@example.com'))).toThrow(
      ForbiddenException,
    );
  });
});
