import { Prisma } from '../../generated/prisma/client';
import { isTransactionConflictError } from './prisma-conflict.util';

describe('isTransactionConflictError', () => {
  it('recognizes a DriverAdapterError write conflict (the shape @prisma/adapter-pg actually throws)', () => {
    const err = new Error('TransactionWriteConflict');
    err.name = 'DriverAdapterError';
    (err as unknown as { cause: { kind: string } }).cause = {
      kind: 'TransactionWriteConflict',
    };

    expect(isTransactionConflictError(err)).toBe(true);
  });

  it('recognizes the classic PrismaClientKnownRequestError P2034 shape too', () => {
    const err = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });

    expect(isTransactionConflictError(err)).toBe(true);
  });

  it('does not misclassify an unrelated error', () => {
    expect(isTransactionConflictError(new Error('boom'))).toBe(false);
    expect(isTransactionConflictError(new TypeError('nope'))).toBe(false);
    expect(isTransactionConflictError(undefined)).toBe(false);
  });

  it('does not misclassify a DriverAdapterError of a different kind', () => {
    const err = new Error('SomeOtherFailure');
    err.name = 'DriverAdapterError';
    (err as unknown as { cause: { kind: string } }).cause = {
      kind: 'SomeOtherFailure',
    };

    expect(isTransactionConflictError(err)).toBe(false);
  });
});
