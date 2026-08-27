import type {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';

export interface InitializeChargeParams {
  email: string;
  /** Major currency units, e.g. 500.00 for KES 500. */
  amount: number;
  reference: string;
  subaccountCode?: string;
  metadata?: Record<string, unknown>;
  /** Where the payer's browser returns to after paying. */
  callbackUrl?: string;
}

export interface InitializeChargeResult {
  authorizationUrl: string;
  accessCode: string;
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

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProvider {
  initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult>;
  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean;
  parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent;
  /**
   * Defense-in-depth: an independent, server-to-server confirmation of a
   * transaction's status/amount directly from the gateway, called before
   * crediting anything — a webhook signature check alone isn't treated as
   * sufficient for a financial credit. See Paystack's own guidance:
   * https://paystack.com/docs/payments/verify-payments/
   */
  verifyTransaction(reference: string): Promise<VerifiedTransaction>;
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
