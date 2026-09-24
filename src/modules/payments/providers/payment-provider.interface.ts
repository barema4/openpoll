import type {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type { PaymentProviderName } from '../../../config/supported-countries';

// The channels a payer can be offered at Paystack's hosted checkout. When the
// payer has already picked one on our own pay page (for clarity — "Pay with
// card" vs "Pay with M-Pesa" as distinct actions, rather than a single
// generic button), we pass just that one through so Paystack skips straight
// to it instead of showing a channel picker of its own.
export const PAYMENT_METHODS = ['card', 'mobile_money'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Every mobile-network operator PawaPay identifies, across every
// PawaPay-backed country in SUPPORTED_COUNTRIES — confirmed against
// PawaPay's own docs (docs.pawapay.io/v2/docs/providers). Grouped per
// country below (MOBILE_MONEY_PROVIDERS_BY_COUNTRY) for validating that a
// submitted operator actually belongs to the country being charged; this
// flat list exists for call sites (DTO @IsIn checks) that only need "is this
// a recognized operator code at all," not which country it belongs to.
export const MOBILE_MONEY_PROVIDERS_BY_COUNTRY = {
  KE: [{ code: 'MPESA_KEN', label: 'M-Pesa' }],
  UG: [
    { code: 'MTN_MOMO_UGA', label: 'MTN Mobile Money' },
    { code: 'AIRTEL_OAPI_UGA', label: 'Airtel Money' },
  ],
  GH: [
    { code: 'MTN_MOMO_GHA', label: 'MTN Mobile Money' },
    { code: 'AIRTELTIGO_GHA', label: 'AirtelTigo Money' },
    { code: 'VODAFONE_GHA', label: 'Vodafone Cash' },
  ],
  TZ: [
    { code: 'AIRTEL_TZA', label: 'Airtel Money' },
    { code: 'VODACOM_TZA', label: 'Vodacom M-Pesa' },
    { code: 'TIGO_TZA', label: 'Tigo Pesa' },
    { code: 'HALOTEL_TZA', label: 'Halotel Money' },
  ],
  RW: [
    { code: 'AIRTEL_RWA', label: 'Airtel Money' },
    { code: 'MTN_MOMO_RWA', label: 'MTN Mobile Money' },
  ],
  ZM: [
    { code: 'AIRTEL_OAPI_ZMB', label: 'Airtel Money' },
    { code: 'MTN_MOMO_ZMB', label: 'MTN Mobile Money' },
    { code: 'ZAMTEL_ZMB', label: 'Zamtel Money' },
  ],
  MW: [
    { code: 'AIRTEL_MWI', label: 'Airtel Money' },
    { code: 'TNM_MWI', label: 'TNM Mpamba' },
  ],
  NG: [
    { code: 'AIRTEL_NGA', label: 'Airtel Money' },
    { code: 'MTN_MOMO_NGA', label: 'MTN Mobile Money' },
  ],
  CM: [
    { code: 'MTN_MOMO_CMR', label: 'MTN Mobile Money' },
    { code: 'ORANGE_CMR', label: 'Orange Money' },
  ],
  CI: [
    { code: 'MTN_MOMO_CIV', label: 'MTN Mobile Money' },
    { code: 'ORANGE_CIV', label: 'Orange Money' },
    { code: 'WAVE_CIV', label: 'Wave' },
  ],
  SN: [
    { code: 'FREE_SEN', label: 'Free Money' },
    { code: 'ORANGE_SEN', label: 'Orange Money' },
    { code: 'WAVE_SEN', label: 'Wave' },
  ],
  BJ: [
    { code: 'MTN_MOMO_BEN', label: 'MTN Mobile Money' },
    { code: 'MOOV_BEN', label: 'Moov Money' },
  ],
  BF: [
    { code: 'MOOV_BFA', label: 'Moov Money' },
    { code: 'ORANGE_BFA', label: 'Orange Money' },
  ],
  CG: [
    { code: 'AIRTEL_COG', label: 'Airtel Money' },
    { code: 'MTN_MOMO_COG', label: 'MTN Mobile Money' },
  ],
  CD: [
    { code: 'VODACOM_MPESA_COD', label: 'Vodacom M-Pesa' },
    { code: 'AIRTEL_COD', label: 'Airtel Money' },
    { code: 'ORANGE_COD', label: 'Orange Money' },
  ],
  GA: [{ code: 'AIRTEL_GAB', label: 'Airtel Money' }],
  SL: [{ code: 'ORANGE_SLE', label: 'Orange Money' }],
  LS: [{ code: 'MPESA_LSO', label: 'M-Pesa' }],
  MZ: [
    { code: 'MOVITEL_MOZ', label: 'Movitel' },
    { code: 'VODACOM_MOZ', label: 'Vodacom M-Pesa' },
  ],
  ET: [{ code: 'MPESA_ETH', label: 'M-Pesa' }],
} as const;

type CountryOperators =
  (typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY)[keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY][number];
export type MobileMoneyProvider = CountryOperators['code'];

export const MOBILE_MONEY_PROVIDERS = Object.values(
  MOBILE_MONEY_PROVIDERS_BY_COUNTRY,
).flatMap((operators) => operators.map((operator) => operator.code));

// Beyond "is this a recognized code at all" (MOBILE_MONEY_PROVIDERS), this
// confirms the operator actually belongs to the country being charged — e.g.
// rejects an MTN Ghana code submitted for a Uganda event — with a clear
// error instead of letting PawaPay's own API reject the mismatch deep in a
// gateway call.
export function isMobileMoneyProviderForCountry(
  countryCode: string,
  value: string | undefined,
): value is MobileMoneyProvider {
  if (!value) return false;
  const operators =
    MOBILE_MONEY_PROVIDERS_BY_COUNTRY[
      countryCode as keyof typeof MOBILE_MONEY_PROVIDERS_BY_COUNTRY
    ];
  return (operators ?? []).some((operator) => operator.code === value);
}

export interface InitializeChargeParams {
  email: string;
  /** Major currency units, e.g. 500.00 for KES 500, or 15000 for UGX 15,000. */
  amount: number;
  reference: string;
  subaccountCode?: string;
  /**
   * The platform's cut, already folded into `amount` (i.e. `amount` is
   * base + fee) — passed separately so a provider that supports gateway-level
   * splitting (Paystack, via `transaction_charge`) can route it to the
   * platform's own account instead of the payee's. Ignored by providers with
   * no split mechanism (PawaPay) — the caller must still fold it into
   * `metadata` for those, so it survives to the webhook for later reconciliation.
   */
  platformFeeAmount?: number;
  metadata?: Record<string, unknown>;
  /** Where the payer's browser returns to after paying. Redirect-based providers (Paystack) only. */
  callbackUrl?: string;
  /** Restricts Paystack's hosted checkout to just this channel. */
  channels?: PaymentMethod[];
  /** ISO 4217 code. Required for PawaPay (e.g. "UGX"); Paystack infers it from the account. */
  currency?: string;
  /**
   * Required for a direct mobile-money charge (PawaPay): there is no hosted
   * page for the payer to enter this on — we push the payment prompt
   * straight to their phone, so we need the number and which network up front.
   */
  mobileMoney?: { phoneNumber: string; provider: MobileMoneyProvider };
}

export interface InitializeChargeResult {
  /**
   * 'redirect': send the payer's browser to `authorizationUrl` (Paystack —
   * they complete payment on the provider's hosted page).
   * 'pending': no redirect exists — a prompt was pushed directly to the
   * payer's phone (PawaPay). The pay page should show a "check your phone"
   * state instead, and the payer/organizer discovers success via the
   * transaction list once the webhook lands.
   */
  status: 'redirect' | 'pending';
  authorizationUrl?: string;
  accessCode?: string;
  reference: string;
}

export interface ParsedWebhookEvent {
  eventType: string;
  providerReference: string;
  /** Major currency units. */
  amountSettled: number;
  status: TransactionStatus;
  paymentRail: PaymentRail;
  invoiceId?: string;
  eventId?: string;
  /** Set instead of invoiceId/eventId for a standalone personal-invoice charge. */
  personalInvoiceId?: string;
  /** The platform's cut, included in amountSettled — subtract before crediting. */
  platformFeeAmount?: number;
  /**
   * Which gateway produced this event — set by each provider's own
   * parseWebhookEvent(), not re-derived from the organization's country.
   * An org's country can map to a different provider than the one that
   * actually processed a given historical transaction (a provider cutover,
   * or a one-off charge routed to a different provider than usual), so
   * verifying/refunding a specific transaction must key off this persisted
   * value (Transaction.gateway) rather than re-deriving from country at
   * verify/refund time. See PaymentProviderRegistry.byName().
   */
  provider: PaymentProviderName;
  /**
   * ISO 4217 code of the currency actually charged — set by each provider
   * from the real charge/session data, not assumed from the event's own
   * currency. Almost always equal to the event's currency, except a card
   * fallback charged in a different currency than the event's own (e.g. a
   * USD diaspora contribution to a UGX event) — that mismatch is what tags
   * a transaction as a secondary-currency contribution everywhere it's
   * queried, so this must reflect the real charge, not be copied from the
   * event.
   */
  currency: string;
}

export interface VerifiedTransaction {
  status: TransactionStatus;
  /** Major currency units. */
  amountSettled: number;
  currency: string;
}

export const PAYSTACK_PROVIDER = Symbol('PAYSTACK_PROVIDER');
export const PAWAPAY_PROVIDER = Symbol('PAWAPAY_PROVIDER');

// Shared across every payment provider — charging and confirming a charge.
// Payout/bank concerns live in BankPayoutProvider below since PawaPay (or any
// mobile-money-only provider) has no equivalent of a bank account or a
// subaccount-style routing token.
export interface PaymentProvider {
  initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult>;
  parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent;
  /**
   * Defense-in-depth: an independent, server-to-server confirmation of a
   * transaction's status/amount directly from the gateway, called before
   * crediting anything — a webhook signature check alone isn't treated as
   * sufficient for a financial credit. See Paystack's own guidance:
   * https://paystack.com/docs/payments/verify-payments/
   */
  verifyTransaction(reference: string): Promise<VerifiedTransaction>;
}

export interface Bank {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
}

export interface CreateSubaccountParams {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  /** Percentage of each charge kept by the platform's main account. 0 = payee keeps 100%. */
  percentageCharge?: number;
}

export interface SubaccountResult {
  subaccountCode: string;
}

// Kenya/Paystack-only: bank-account payout onboarding. Nothing implements
// this for Uganda — PawaPay payouts go straight to a phone number, no bank
// directory, no name-resolution step, no subaccount token (see Withdrawal).
export interface BankPayoutProvider {
  /** The bank directory for payout onboarding — lets a user pick their bank by name. */
  listBanks(): Promise<Bank[]>;
  /**
   * Confirms an account number against a bank and returns the account
   * holder's name on file, so a user can see they typed it correctly
   * before it becomes their payout destination.
   */
  resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<ResolvedAccount>;
  /**
   * Creates the payout destination itself — a Paystack "subaccount" tied to
   * a real bank account. The returned code is what gets passed as
   * `subaccountCode` on every future charge routed to this payee.
   */
  createSubaccount(params: CreateSubaccountParams): Promise<SubaccountResult>;
}

export interface PayBankAccountVendorParams {
  /** Our own idempotency reference for this payout attempt. */
  transferId: string;
  amount: number;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
}

export interface VendorTransferResult {
  accepted: boolean;
  providerReference?: string;
  failureMessage?: string;
}

// Kenya/Paystack-only: bank-account vendor payouts (DisbursementsService).
// PawaPay vendor payouts go straight to a phone number via
// PawaPayProvider.initiatePayout instead — no recipient-creation step, so
// no equivalent interface is needed there.
export interface BankAccountVendorPayoutProvider {
  payBankAccountVendor(
    params: PayBankAccountVendorParams,
  ): Promise<VendorTransferResult>;
}
