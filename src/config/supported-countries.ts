// Single source of truth for "which countries does this app support, and
// how does each one get charged/paid out." Adding a new country is a new
// entry here — never a schema migration or a new `if (country === X)`
// branch, since PaymentProviderRegistry and every service in this codebase
// resolve provider/currency/charge-shape through this table instead of a
// hardcoded switch. See prisma/schema.prisma's Organization/User.country
// comment for how this replaced the old OrganizationCountry enum.
export type PaymentProviderName = 'PAYSTACK' | 'PAWAPAY';

// 'REDIRECT': the payer completes payment on the provider's hosted page
// (historically Paystack) — PaymentsService needs a callbackUrl, nothing
// else. No current SUPPORTED_COUNTRIES entry uses this shape; kept for
// historical Paystack-processed data (Transaction.gateway) and in case a
// future redirect-based provider is added.
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
  // Kenya moved from PAYSTACK to PAWAPAY (M-Pesa) — Paystack is fully
  // retired as a charge/payout rail. PaystackProvider and its Prisma fields
  // stay wired up read-only, purely for verifying/refunding transactions
  // that were already processed through it before this cutover (see
  // Transaction.gateway, PaymentProviderRegistry.byName()) — no new charge
  // or payout ever routes through it again.
  KE: {
    label: 'Kenya',
    currency: 'KES',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  UG: {
    label: 'Uganda',
    currency: 'UGX',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },

  // Every other PawaPay-supported African country (per docs.pawapay.io/v2/
  // docs/providers, checked 2026-09) — mobile-money collection/payout via
  // PawaPayProvider already works generically for any of these, same as
  // Kenya/Uganda above; adding one is exactly this: label + currency,
  // nothing else.
  GH: {
    label: 'Ghana',
    currency: 'GHS',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  TZ: {
    label: 'Tanzania',
    currency: 'TZS',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  RW: {
    label: 'Rwanda',
    currency: 'RWF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  ZM: {
    label: 'Zambia',
    currency: 'ZMW',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  MW: {
    label: 'Malawi',
    currency: 'MWK',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  NG: {
    label: 'Nigeria',
    currency: 'NGN',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  CM: {
    label: 'Cameroon',
    currency: 'XAF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  CI: {
    label: "Côte d'Ivoire",
    currency: 'XOF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  SN: {
    label: 'Senegal',
    currency: 'XOF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  BJ: {
    label: 'Benin',
    currency: 'XOF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  BF: {
    label: 'Burkina Faso',
    currency: 'XOF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  CG: {
    label: 'Republic of the Congo',
    currency: 'XAF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  CD: {
    label: 'DR Congo',
    currency: 'CDF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  GA: {
    label: 'Gabon',
    currency: 'XAF',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  SL: {
    label: 'Sierra Leone',
    currency: 'SLE',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  LS: {
    label: 'Lesotho',
    currency: 'LSL',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  MZ: {
    label: 'Mozambique',
    currency: 'MZN',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
  },
  ET: {
    label: 'Ethiopia',
    currency: 'ETB',
    provider: 'PAWAPAY',
    chargeShape: 'MOBILE_MONEY_PUSH',
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
