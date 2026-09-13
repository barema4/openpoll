// Charged additively on top of what a payer intends to give — the org is
// always credited exactly `baseAmount`, never `baseAmount + fee`.
export function calculatePlatformFee(
  baseAmount: number,
  feePercent: number,
): number {
  return Math.round(baseAmount * (feePercent / 100) * 100) / 100;
}
