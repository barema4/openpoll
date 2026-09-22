// Single source of truth for "which countries does this app support, and
// how does each one get charged/paid out." Adding a new country is a new
// entry here — never a schema migration or a new `if (country === X)`
// branch, since PaymentProviderRegistry and every service in this codebase
// resolve provider/currency/charge-shape through this table instead of a
// hardcoded switch. See prisma/schema.prisma's Organization/User.country
// comment for how this replaced the old OrganizationCountry enum.
export type PaymentProviderName = 'PAYSTACK' | 'PAWAPAY' | 'STRIPE';

// 'REDIRECT': the payer completes payment on the provider's hosted page
// (Paystack, Stripe) — PaymentsService needs a callbackUrl, nothing else.
// 'MOBILE_MONEY_PUSH': no hosted page exists — a prompt is pushed directly
// to the payer's phone (PawaPay), so PaymentsService needs a phone number
// and network up front instead.
export type ChargeShape = 'REDIRECT' | 'MOBILE_MONEY_PUSH';

export interface SupportedCountry {
  label: string;
  /** ISO 4217 code. */
  currency: string;
  provider: PaymentProviderName;
  chargeShape: ChargeShape;
}

// Seeded behavior-preserving for the two countries this app already
// supported under the old OrganizationCountry enum — KE/UG here are exactly
// equivalent to the old KENYA/UGANDA values, just as ISO-3166-1 alpha-2
// codes instead of enum members.
export const SUPPORTED_COUNTRIES: Record<string, SupportedCountry> = {
  KE: {
    label: 'Kenya',
    currency: 'KES',
    provider: 'PAYSTACK',
    chargeShape: 'REDIRECT',
  },
  UG: {
    label: 'Uganda',
    currency: 'UGX',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  // First two Stripe-backed countries — donor charging only for now (see
  // StripeProvider); Stripe Connect payout onboarding lands in a later
  // phase, so orgs here have their whole charge land in the platform's own
  // Stripe balance until then, same fallback already established for an
  // unconfigured Paystack payout destination.
  US: {
    label: 'United States',
    currency: 'USD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  GB: {
    label: 'United Kingdom',
    currency: 'GBP',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
};

export const DEFAULT_COUNTRY_CODE = 'KE';

export function getSupportedCountry(countryCode: string): SupportedCountry {
  const country = SUPPORTED_COUNTRIES[countryCode];
  if (!country) {
    throw new Error(`Unsupported country code: ${countryCode}`);
  }
  return country;
}

export function currencyForCountry(countryCode: string): string {
  return getSupportedCountry(countryCode).currency;
}
