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
}

export interface VerifiedTransaction {
  status: TransactionStatus;
  /** Major currency units. */
  amountSettled: number;
  currency: string;
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
}
