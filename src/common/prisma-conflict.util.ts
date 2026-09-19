import { Prisma } from '../../generated/prisma/client';

// Detects a Postgres serialization failure from a Serializable transaction
// aborted due to a genuine write conflict with a concurrent request — the
// mechanism this app relies on to prevent double-spending real money (see
// DisbursementsService.pay / WithdrawalsService.requestWithdrawal).
//
// This project runs on the @prisma/adapter-pg driver adapter, which surfaces
// the conflict as a DriverAdapterError (name: 'DriverAdapterError', cause:
// { kind: 'TransactionWriteConflict' }) rather than the classic engine's
// PrismaClientKnownRequestError (code P2034) — checked for too, in case a
// future Prisma/adapter version reports it that way instead. Duck-typed
// rather than an `instanceof` check against @prisma/driver-adapter-utils,
// since that package is only a transitive dependency here, not a direct one.
export function isTransactionConflictError(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2034'
  ) {
    return true;
  }
  if (
    err instanceof Error &&
    err.name === 'DriverAdapterError' &&
    (err as { cause?: { kind?: string } }).cause?.kind ===
      'TransactionWriteConflict'
  ) {
    return true;
  }
  return false;
}
