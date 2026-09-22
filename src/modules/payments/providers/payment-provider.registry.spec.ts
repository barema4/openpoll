import { PaymentProviderRegistry } from './payment-provider.registry';
import type { PaymentProvider } from './payment-provider.interface';

describe('PaymentProviderRegistry.forCountry', () => {
  const paystack = {} as unknown as PaymentProvider;
  const pawapay = {} as unknown as PaymentProvider;
  const stripe = {} as unknown as PaymentProvider;
  const registry = new PaymentProviderRegistry(paystack, pawapay, stripe);

  it('resolves Paystack for a Kenya country code', () => {
    expect(registry.forCountry('KE')).toBe(paystack);
  });

  it('resolves PawaPay for a Uganda country code', () => {
    expect(registry.forCountry('UG')).toBe(pawapay);
  });

  it('resolves Stripe for a US country code', () => {
    expect(registry.forCountry('US')).toBe(stripe);
  });

  it('throws for an unmapped country code rather than silently defaulting', () => {
    expect(() => registry.forCountry('ZZ')).toThrow(/Unsupported country code/);
  });
});
