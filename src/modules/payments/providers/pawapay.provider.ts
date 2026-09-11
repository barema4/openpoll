import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createVerify } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type {
  InitializeChargeParams,
  InitializeChargeResult,
  MobileMoneyProvider,
  ParsedWebhookEvent,
  PaymentProvider,
  VerifiedTransaction,
} from './payment-provider.interface';

// PawaPay's deposit/payout resource shape, confirmed against docs.pawapay.io
// (v2/api-reference/deposits, v2/docs/providers). This integration was built
// from public documentation, not a live sandbox account — before going to
// production, verify against a real PawaPay sandbox: the metadata array
// shape, the exact deposit-callback payload, and the public-keys endpoint
// path are the pieces most likely to need a small correction (each flagged
// below at the exact point it matters).
interface PawaPayDepositResponse {
  depositId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED';
  failureReason?: { failureCode: string; failureMessage: string };
}

interface PawaPayPayoutResponse {
  payoutId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE_IGNORED';
  failureReason?: { failureCode: string; failureMessage: string };
}

interface PawaPayDepositData {
  depositId: string;
  status:
    'ACCEPTED' | 'PROCESSING' | 'IN_RECONCILIATION' | 'COMPLETED' | 'FAILED';
  amount: string;
  currency: string;
}

interface PawaPayDepositSearchResult {
  status: 'FOUND' | 'NOT_FOUND';
  data?: PawaPayDepositData;
}

@Injectable()
export class PawaPayProvider implements PaymentProvider {
  private readonly logger = new Logger(PawaPayProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('PAWAPAY_BASE_URL')!.replace(/\/$/, '');
  }

  private get token(): string {
    return this.config.get<string>('PAWAPAY_API_TOKEN')!;
  }

  async initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult> {
    if (!params.mobileMoney) {
      throw new BadGatewayException(
        'PawaPay charges require a phone number and network — mobileMoney params missing',
      );
    }

    // TODO(verify against real PawaPay sandbox): metadata array field names
    // (fieldName/fieldValue) are inferred from the docs summary, not a raw
    // schema — double check before relying on this in production.
    const metadata = Object.entries(params.metadata ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([fieldName, value]) => ({ fieldName, fieldValue: String(value) }));

    const response = await fetch(`${this.baseUrl}/deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        depositId: params.reference,
        amount: String(params.amount),
        currency: params.currency ?? 'UGX',
        payer: {
          type: 'MMO',
          accountDetails: {
            phoneNumber: params.mobileMoney.phoneNumber,
            provider: params.mobileMoney.provider,
          },
        },
        metadata: metadata.length > 0 ? metadata : undefined,
      }),
    });

    const body = (await response.json()) as PawaPayDepositResponse;
    if (!response.ok || body.status !== 'ACCEPTED') {
      throw new BadGatewayException(
        `PawaPay deposit initiation failed: ${body.failureReason?.failureMessage ?? body.status}`,
      );
    }

    return { status: 'pending', reference: body.depositId };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const response = await fetch(
      `${this.baseUrl}/deposits/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );

    const body = (await response.json()) as PawaPayDepositSearchResult;
    if (!response.ok || body.status !== 'FOUND' || !body.data) {
      throw new BadGatewayException(
        `PawaPay deposit lookup failed for ${reference}`,
      );
    }

    return {
      status: mapDepositStatus(body.data.status),
      amountSettled: Number(body.data.amount),
      currency: body.data.currency,
    };
  }

  // Withdrawals only (Uganda) — no Paystack equivalent (its subaccount model
  // routes at charge time, nothing to explicitly pay out later), so this
  // isn't part of the shared PaymentProvider interface. Callers inject
  // PawaPayProvider concretely.
  async initiatePayout(params: {
    payoutId: string;
    amount: number;
    currency: string;
    phoneNumber: string;
    provider: MobileMoneyProvider;
  }): Promise<{
    payoutId: string;
    accepted: boolean;
    failureMessage?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payoutId: params.payoutId,
        amount: String(params.amount),
        currency: params.currency,
        recipient: {
          type: 'MMO',
          accountDetails: {
            phoneNumber: params.phoneNumber,
            provider: params.provider,
          },
        },
      }),
    });

    const body = (await response.json()) as PawaPayPayoutResponse;
    return {
      payoutId: body.payoutId ?? params.payoutId,
      accepted: response.ok && body.status === 'ACCEPTED',
      failureMessage: body.failureReason?.failureMessage,
    };
  }

  // TODO(verify against real PawaPay sandbox): field names below
  // (status/amount/currency/metadata) mirror the documented deposit-status
  // response shape — PawaPay's actual callback payload should be confirmed
  // to match before relying on this for production credit decisions. The
  // independent verifyTransaction() re-check in WebhookProcessor is the real
  // safety net regardless.
  parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent {
    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PawaPayDepositData & {
      metadata?: { fieldName: string; fieldValue: string }[];
    };
    const metadata = metadataArrayToRecord(payload.metadata);

    return {
      eventType: `deposit.${payload.status.toLowerCase()}`,
      providerReference: payload.depositId,
      amountSettled: Number(payload.amount),
      status: mapDepositStatus(payload.status),
      paymentRail: PaymentRail.MOBILE_MONEY,
      invoiceId: metadata.invoiceId,
      eventId: metadata.eventId,
      personalInvoiceId: metadata.personalInvoiceId,
    };
  }

  // RFC-9421 HTTP Message Signature verification (ECDSA P-256 / SHA-256).
  // Unlike Paystack's single shared-secret HMAC header, PawaPay signs over a
  // reconstructed "signature base" covering the request method/path/authority
  // plus specific headers, verified against PawaPay's public key.
  //
  // TODO(verify against real PawaPay sandbox): the public key is sourced from
  // config (PAWAPAY_PUBLIC_KEY) rather than fetched live by `keyid` from
  // PawaPay's Public Keys endpoint — simpler to ship first, but won't survive
  // an unannounced key rotation. Upgrade to fetch+cache-by-keyid if that
  // becomes a problem in practice.
  verifyWebhookSignature(request: RawBodyRequest<Request>): boolean {
    const rawBody = request.rawBody;
    const signature = request.headers['signature'] as string | undefined;
    const signatureInput = request.headers['signature-input'] as
      string | undefined;
    const contentDigest = request.headers['content-digest'] as
      string | undefined;
    const signatureDate = request.headers['signature-date'] as
      string | undefined;
    const publicKeyPem = this.config.get<string>('PAWAPAY_PUBLIC_KEY');

    if (
      !rawBody ||
      !signature ||
      !signatureInput ||
      !contentDigest ||
      !publicKeyPem
    ) {
      return false;
    }

    const expectedDigest = `sha-256=:${createHash('sha256').update(rawBody).digest('base64')}:`;
    if (contentDigest !== expectedDigest) return false;

    // Signature-Input looks like: sig1=("@method" "@path" "content-digest");keyid="...";alg="ecdsa-p256-sha256"
    const label = signatureInput.split('=')[0];
    const componentsMatch = signatureInput.match(/\(([^)]*)\)/);
    const components = componentsMatch
      ? componentsMatch[1].split(' ').map((c) => c.replace(/"/g, ''))
      : [];
    const paramsPart = signatureInput.slice(signatureInput.indexOf(')') + 1);

    const lines = components.map((component) => {
      const value =
        component === '@method'
          ? request.method
          : component === '@path'
            ? request.url.split('?')[0]
            : component === '@authority'
              ? request.headers.host
              : component === 'content-digest'
                ? contentDigest
                : component === 'signature-date'
                  ? signatureDate
                  : (request.headers[component] as string | undefined);
      return `"${component}": ${value}`;
    });
    lines.push(
      `"@signature-params": (${components.map((c) => `"${c}"`).join(' ')})${paramsPart}`,
    );
    const signatureBase = lines.join('\n');

    // Signature header looks like: sig1=:base64(...):
    const sigValueMatch = signature.match(new RegExp(`${label}=:(.*):`));
    if (!sigValueMatch) return false;
    const signatureBytes = Buffer.from(sigValueMatch[1], 'base64');

    try {
      return createVerify('SHA256')
        .update(signatureBase)
        .verify(publicKeyPem, signatureBytes);
    } catch (err) {
      this.logger.error(`PawaPay signature verification error: ${String(err)}`);
      return false;
    }
  }
}

function mapDepositStatus(status: string): TransactionStatus {
  if (status === 'COMPLETED') return TransactionStatus.SUCCESS;
  if (status === 'FAILED') return TransactionStatus.FAILED;
  return TransactionStatus.PENDING;
}

function metadataArrayToRecord(
  metadata?: { fieldName: string; fieldValue: string }[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of metadata ?? []) {
    record[entry.fieldName] = entry.fieldValue;
  }
  return record;
}
