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
}
