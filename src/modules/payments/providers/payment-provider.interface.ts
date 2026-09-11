import type {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';

// The channels a payer can be offered at Paystack's hosted checkout. When the
// payer has already picked one on our own pay page (for clarity — "Pay with
// card" vs "Pay with M-Pesa" as distinct actions, rather than a single
// generic button), we pass just that one through so Paystack skips straight
// to it instead of showing a channel picker of its own.
export const PAYMENT_METHODS = ['card', 'mobile_money'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Uganda mobile money operators, as PawaPay identifies them.
export const MOBILE_MONEY_PROVIDERS = [
  'MTN_MOMO_UGA',
  'AIRTEL_OAPI_UGA',
] as const;
export type MobileMoneyProvider = (typeof MOBILE_MONEY_PROVIDERS)[number];

export interface InitializeChargeParams {
  email: string;
  /** Major currency units, e.g. 500.00 for KES 500, or 15000 for UGX 15,000. */
  amount: number;
  reference: string;
  subaccountCode?: string;
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
