import { calculatePlatformFee } from './platform-fee.util';

describe('calculatePlatformFee', () => {
  it('computes a percentage of the base amount', () => {
    expect(calculatePlatformFee(1000, 1.5)).toBe(15);
  });

  it('rounds to 2 decimal places', () => {
    expect(calculatePlatformFee(333, 1.5)).toBe(5);
    expect(calculatePlatformFee(10, 1.5)).toBe(0.15);
  });

  it('is zero when the fee percent is zero', () => {
    expect(calculatePlatformFee(1000, 0)).toBe(0);
  });
});
