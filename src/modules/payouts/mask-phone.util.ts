// The full mobile money number is kept server-side (PawaPay needs it on
// every payout — there's no subaccount-style opaque token like Paystack's),
// but never returned to the client, matching the payoutAccountLast4
// convention already used for bank payouts. Shared by User and Organization
// records, which both carry a payoutMobileNumber column.
export function maskPhone<T extends { payoutMobileNumber: string | null }>(
  entity: T,
): Omit<T, 'payoutMobileNumber'> & { payoutMobileNumberLast4: string | null } {
  const { payoutMobileNumber, ...rest } = entity;
  return {
    ...rest,
    payoutMobileNumberLast4: payoutMobileNumber?.slice(-4) ?? null,
  };
}
