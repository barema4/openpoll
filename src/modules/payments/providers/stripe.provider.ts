import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DisputeStatus,
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import { verifyStripeSignature } from '../../../common/stripe-signature.util';
import type {
  InitializeChargeParams,
  InitializeChargeResult,
  ParsedWebhookEvent,
  PaymentProvider,
  VerifiedTransaction,
} from './payment-provider.interface';
import type {
  ParsedDisputeWebhookEvent,
  ParsedRefundWebhookEvent,
} from './paystack.provider';

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

interface StripeErrorResponse {
  error?: { message?: string };
}

interface StripeCheckoutSession {
  id: string;
  url: string;
  payment_intent: string | { id: string } | null;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

interface StripeBalanceResponse {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export interface ProviderBalance {
  currency: string;
  /** Major currency units. */
  balance: number;
}

// checkout.session.completed's data.object shape — a superset of the
// creation response, plus the fields WebhookProcessor needs (metadata,
// client_reference_id).
interface StripeCheckoutSessionEventObject extends StripeCheckoutSession {
  metadata?: Record<string, string>;
}

interface StripeChargeEventObject {
  id: string;
  payment_intent: string | null;
  refunded: boolean;
  amount_refunded: number;
}

interface StripeDisputeEventObject {
  id: string;
  payment_intent: string | null;
  status: string;
  amount: number;
  reason: string | null;
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

// Card/global donor charging, for any organization whose country maps to
// STRIPE in SUPPORTED_COUNTRIES (src/config/supported-countries.ts) — the
// same role Paystack/PawaPay play for Kenya/Uganda. Plain fetch against
// Stripe's REST API, no SDK, matching PaystackProvider's style.
//
// Identifier choice: unlike Paystack/PawaPay (which accept a caller-supplied
// reference as the charge's own primary id), a Stripe Checkout Session's id
// isn't shared by the refund/dispute objects that later reference the same
// payment — so providerReference here is the *PaymentIntent* id throughout
// (requested via expand[]=payment_intent at session-creation time), since
// that id threads consistently through checkout.session.completed,
// charge.refunded, and charge.dispute.* alike.
@Injectable()
export class StripeProvider implements PaymentProvider {
  constructor(private readonly config: ConfigService) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(`${STRIPE_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.get<string>('STRIPE_SECRET_KEY')}`,
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const data = (await response.json()) as T & StripeErrorResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        data.error?.message ?? 'Stripe request failed',
      );
    }
    return data;
  }

  async initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult> {
    const body: Record<string, string> = {
      mode: 'payment',
      'expand[0]': 'payment_intent',
      customer_email: params.email,
      client_reference_id: params.reference,
      'line_items[0][price_data][currency]': (
        params.currency ?? 'usd'
      ).toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(
        Math.round(params.amount * 100),
      ),
      'line_items[0][price_data][product_data][name]': 'Contribution',
      'line_items[0][quantity]': '1',
      success_url: params.callbackUrl ?? 'https://openpool.app/receipt',
      cancel_url: params.callbackUrl ?? 'https://openpool.app/receipt',
    };
    // No Connect account exists for this org yet (see Phase 3) — the whole
    // charge lands in the platform's own Stripe balance, same fallback
    // already established for an unconfigured Paystack payout destination.
    for (const [key, value] of Object.entries(params.metadata ?? {})) {
      if (value === undefined) continue;
      const stringValue = metadataValueToString(value);
      body[`metadata[${key}]`] = stringValue;
      body[`payment_intent_data[metadata][${key}]`] = stringValue;
    }

    const session = await this.request<StripeCheckoutSession>(
      'POST',
      '/checkout/sessions',
      body,
    );
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) {
      throw new BadGatewayException(
        'Stripe checkout session was created without a payment intent',
      );
    }

    return {
      status: 'redirect',
      authorizationUrl: session.url,
      accessCode: session.id,
      reference: paymentIntentId,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const intent = await this.request<StripePaymentIntent>(
      'GET',
      `/payment_intents/${encodeURIComponent(reference)}`,
    );

    return {
      status: mapIntentStatus(intent.status),
      amountSettled: intent.amount / 100,
      currency: intent.currency.toUpperCase(),
    };
  }

  // The platform's own main-account balance — used for reconciliation, not
  // any charge/payout flow. Mirrors PaystackProvider.getBalance(); Stripe
  // splits available vs pending per currency, summed here into one figure
  // per currency to match Paystack's single-total shape.
  async getBalance(): Promise<ProviderBalance[]> {
    const balance = await this.request<StripeBalanceResponse>(
      'GET',
      '/balance',
    );
    const totals = new Map<string, number>();
    for (const bucket of [...balance.available, ...balance.pending]) {
      const currency = bucket.currency.toUpperCase();
      totals.set(currency, (totals.get(currency) ?? 0) + bucket.amount / 100);
    }
    return Array.from(totals, ([currency, balanceAmount]) => ({
      currency,
      balance: balanceAmount,
    }));
  }

  parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent {
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    const session = event.data
      .object as unknown as StripeCheckoutSessionEventObject;
    const metadata = session.metadata ?? {};
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    return {
      eventType: event.type,
      providerReference: paymentIntentId ?? '',
      amountSettled: (session.amount_total ?? 0) / 100,
      status: mapSessionStatus(event.type, session.payment_status),
      paymentRail: PaymentRail.CARD,
      invoiceId: metadata.invoiceId,
      eventId: metadata.eventId,
      personalInvoiceId: metadata.personalInvoiceId,
      platformFeeAmount: metadata.platformFeeAmount
        ? Number(metadata.platformFeeAmount)
        : undefined,
    };
  }

  isRefundEvent(rawBody: Buffer): boolean {
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    return event.type === 'charge.refunded';
  }

  // TODO(verify against a real Stripe test-mode account): a Charge's own id
  // is used as the refund reference below (Stripe's refund-scoped id lives
  // one level deeper, at data.object.refunds.data[0].id, which the basic
  // charge.refunded payload doesn't always expand) — matches this
  // codebase's existing precedent of a best-effort refund-webhook shape for
  // Paystack, flagged the same way, rather than blocking on it here.
  parseRefundWebhookEvent(rawBody: Buffer): ParsedRefundWebhookEvent {
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    const charge = event.data.object as unknown as StripeChargeEventObject;

    return {
      refundReference: charge.id,
      transactionReference: charge.payment_intent ?? '',
      succeeded: charge.refunded === true,
    };
  }

  isDisputeEvent(rawBody: Buffer): boolean {
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    return event.type.startsWith('charge.dispute.');
  }

  parseDisputeWebhookEvent(rawBody: Buffer): ParsedDisputeWebhookEvent {
    const event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
    const dispute = event.data.object as unknown as StripeDisputeEventObject;

    return {
      providerReference: dispute.id,
      transactionReference: dispute.payment_intent ?? '',
      status: mapDisputeStatus(dispute.status),
      resolution: null,
      amount: dispute.amount / 100,
      reason: dispute.reason,
    };
  }

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    const secret = this.config.get<string>('STRIPE_DONOR_WEBHOOK_SECRET');
    if (!secret) return false;
    return verifyStripeSignature(rawBody, signatureHeader, secret);
  }
}

// Stripe metadata values are always flat strings on the wire — params.metadata
// itself is typed as Record<string, unknown> at the shared interface level
// (some callers pass numbers, e.g. platformFeeAmount), so narrow explicitly
// rather than a bare String(value), which could stringify an object as
// "[object Object]" if a caller ever passed one.
function metadataValueToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function mapIntentStatus(status: string): TransactionStatus {
  if (status === 'succeeded') return TransactionStatus.SUCCESS;
  if (status === 'canceled') return TransactionStatus.FAILED;
  return TransactionStatus.PENDING;
}

function mapSessionStatus(
  eventType: string,
  paymentStatus?: string,
): TransactionStatus {
  if (eventType === 'checkout.session.completed' && paymentStatus === 'paid') {
    return TransactionStatus.SUCCESS;
  }
  if (paymentStatus === 'unpaid') return TransactionStatus.PENDING;
  return TransactionStatus.PENDING;
}

function mapDisputeStatus(status: string): DisputeStatus {
  switch (status) {
    case 'under_review':
      return DisputeStatus.AWAITING_BANK_FEEDBACK;
    case 'won':
    case 'lost':
      return DisputeStatus.RESOLVED;
    case 'warning_needs_response':
    case 'needs_response':
    default:
      return DisputeStatus.AWAITING_MERCHANT_FEEDBACK;
  }
}
