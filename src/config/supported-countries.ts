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

  // Every other Stripe-supported country (per stripe.com/global, checked
  // 2026-09) — donor charging (StripeProvider) and payout onboarding
  // (StripeConnectModule) both already work generically for any STRIPE
  // entry here, so adding one is exactly this: label + currency, nothing
  // else. Kenya deliberately stays PAYSTACK above, not STRIPE — Stripe
  // itself only reaches Kenya through its Paystack acquisition, the same
  // rail this app already uses directly.
  AU: {
    label: 'Australia',
    currency: 'AUD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  AT: {
    label: 'Austria',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  BE: {
    label: 'Belgium',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  BR: {
    label: 'Brazil',
    currency: 'BRL',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  BG: {
    label: 'Bulgaria',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  CA: {
    label: 'Canada',
    currency: 'CAD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  HR: {
    label: 'Croatia',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  CY: {
    label: 'Cyprus',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  CZ: {
    label: 'Czech Republic',
    currency: 'CZK',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  DK: {
    label: 'Denmark',
    currency: 'DKK',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  EE: {
    label: 'Estonia',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  FI: {
    label: 'Finland',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  FR: {
    label: 'France',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  DE: {
    label: 'Germany',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  GI: {
    label: 'Gibraltar',
    currency: 'GIP',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  GR: {
    label: 'Greece',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  HK: {
    label: 'Hong Kong',
    currency: 'HKD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  HU: {
    label: 'Hungary',
    currency: 'HUF',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  IE: {
    label: 'Ireland',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  IT: {
    label: 'Italy',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  JP: {
    label: 'Japan',
    currency: 'JPY',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  LV: {
    label: 'Latvia',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  LI: {
    label: 'Liechtenstein',
    currency: 'CHF',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  LT: {
    label: 'Lithuania',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  LU: {
    label: 'Luxembourg',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  MY: {
    label: 'Malaysia',
    currency: 'MYR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  MT: {
    label: 'Malta',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  MX: {
    label: 'Mexico',
    currency: 'MXN',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  NL: {
    label: 'Netherlands',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  NZ: {
    label: 'New Zealand',
    currency: 'NZD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  NO: {
    label: 'Norway',
    currency: 'NOK',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  PL: {
    label: 'Poland',
    currency: 'PLN',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  PT: {
    label: 'Portugal',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  RO: {
    label: 'Romania',
    currency: 'RON',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  SG: {
    label: 'Singapore',
    currency: 'SGD',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  SK: {
    label: 'Slovakia',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  SI: {
    label: 'Slovenia',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  ES: {
    label: 'Spain',
    currency: 'EUR',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  SE: {
    label: 'Sweden',
    currency: 'SEK',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  CH: {
    label: 'Switzerland',
    currency: 'CHF',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  TH: {
    label: 'Thailand',
    currency: 'THB',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  AE: {
    label: 'United Arab Emirates',
    currency: 'AED',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  GB: {
    label: 'United Kingdom',
    currency: 'GBP',
    provider: 'STRIPE',
    chargeShape: 'REDIRECT',
  },
  US: {
    label: 'United States',
    currency: 'USD',
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
