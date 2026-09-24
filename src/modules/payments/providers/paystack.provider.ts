import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  DisputeStatus,
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type {
  Bank,
  BankAccountVendorPayoutProvider,
  BankPayoutProvider,
  CreateSubaccountParams,
  InitializeChargeParams,
  InitializeChargeResult,
  ParsedWebhookEvent,
  PayBankAccountVendorParams,
  PaymentProvider,
  ResolvedAccount,
  SubaccountResult,
  VendorTransferResult,
  VerifiedTransaction,
} from './payment-provider.interface';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackInitializeResponse {
  status: boolean;
  message?: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message?: string;
  data?: {
    status: string;
    amount: number;
    currency: string;
  };
}

interface PaystackBankListResponse {
  status: boolean;
  message?: string;
  data?: { name: string; code: string }[];
}

interface PaystackResolveAccountResponse {
  status: boolean;
  message?: string;
  data?: { account_number: string; account_name: string };
}

interface PaystackSubaccountResponse {
  status: boolean;
  message?: string;
  data?: { subaccount_code: string };
}

interface PaystackBalanceResponse {
  status: boolean;
  message?: string;
  data?: { currency: string; balance: number }[];
}

export interface ProviderBalance {
  currency: string;
  /** Major currency units. */
  balance: number;
}

interface PaystackWebhookPayload {
  event: string;
  data?: {
    reference: string;
    amount?: number;
    currency?: string;
    channel?: string;
    status?: string;
    metadata?: {
      invoiceId?: string;
      eventId?: string;
      personalInvoiceId?: string;
      platformFeeAmount?: string;
    };
  };
}

interface PaystackRefundResponse {
  status: boolean;
  message?: string;
  data?: { id: number; status: string };
}

interface PaystackTransferRecipientResponse {
  status: boolean;
  message?: string;
  data?: { recipient_code: string };
}

interface PaystackTransferResponse {
  status: boolean;
  message?: string;
  data?: { reference: string; status: string };
}

// TODO(verify against real Paystack sandbox): the `refund.processed` /
// `refund.failed` webhook body shape below (data.id as the refund id,
// data.transaction_reference / data.transaction.reference for the original
// charge) is inferred from Paystack's REST refund-object shape, since their
// public docs don't show the webhook callback payload directly — confirm
// before relying on this for production refund completion.
interface PaystackRefundWebhookPayload {
  event: string;
  data?: {
    id: number | string;
    status?: string;
    transaction_reference?: string;
    transaction?: { reference?: string };
  };
}

export interface ParsedRefundWebhookEvent {
  refundReference: string;
  transactionReference: string;
  succeeded: boolean;
}

// TODO(verify against real Paystack sandbox): confirmed from public docs —
// dispute status values (awaiting-merchant-feedback/awaiting-bank-feedback/
// pending/resolved) and resolution values (merchant-accepted/declined) — but
// the exact nesting of these fields inside the charge.dispute.* webhook body
// specifically isn't shown in public docs (only the REST dispute-resource
// shape is). Confirm before relying on this for production dispute handling.
interface PaystackDisputeWebhookPayload {
  event: string;
  data?: {
    id: number | string;
    status?: string;
    resolution?: string;
    amount?: number;
    category?: string;
    transaction?: { reference?: string };
    transaction_reference?: string;
  };
}

export interface ParsedDisputeWebhookEvent {
  providerReference: string;
  transactionReference: string;
  status: DisputeStatus;
  resolution: string | null;
  amount: number;
  reason: string | null;
}

@Injectable()
export class PaystackProvider
  implements
    PaymentProvider,
    BankPayoutProvider,
    BankAccountVendorPayoutProvider
{
  constructor(private readonly config: ConfigService) {}

  async initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult> {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: params.email,
          amount: Math.round(params.amount * 100), // kobo/cents
          reference: params.reference,
          subaccount: params.subaccountCode,
          // Sweeps the platform's fee to the main account instead of the
          // subaccount — only meaningful when there's a subaccount to split
          // with; otherwise the whole charge already lands on the main
          // account and there's nothing to carve out.
          transaction_charge:
            params.subaccountCode && params.platformFeeAmount
              ? Math.round(params.platformFeeAmount * 100)
              : undefined,
          metadata: params.metadata,
          callback_url: params.callbackUrl,
          channels: params.channels,
        }),
      },
    );

    const body = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack charge initialization failed: ${body.message ?? response.statusText}`,
      );
    }

    return {
      status: 'redirect',
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code,
      reference: body.data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        },
      },
    );

    const body = (await response.json()) as PaystackVerifyResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack transaction verification failed: ${body.message ?? response.statusText}`,
      );
    }

    return {
      status: mapStatus('', body.data.status),
      amountSettled: body.data.amount / 100,
      currency: body.data.currency,
    };
  }

  // The platform's own main-account balance — used for reconciliation, not
  // any charge/payout flow. Includes accumulated platform fees (routed here
  // via transaction_charge) plus, as a known confound, the full charge
  // amount for any org/user without a payout subaccount configured yet.
  async getBalance(): Promise<ProviderBalance[]> {
    const response = await fetch(`${PAYSTACK_BASE_URL}/balance`, {
      headers: {
        Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
      },
    });

    const body = (await response.json()) as PaystackBalanceResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack balance check failed: ${body.message ?? response.statusText}`,
      );
    }

    return body.data.map((entry) => ({
      currency: entry.currency,
      balance: entry.balance / 100,
    }));
  }

  // Full refund only (no `amount` field) — Paystack treats an omitted amount
  // as "refund the entire original charge." Completion is async, delivered
  // via the same webhook URL as charges (see parseRefundWebhookEvent).
  async initiateRefund(params: {
    transactionReference: string;
    note?: string;
  }): Promise<{
    refundReference: string;
    accepted: boolean;
    failureMessage?: string;
  }> {
    const response = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: params.transactionReference,
        merchant_note: params.note,
      }),
    });

    const body = (await response.json()) as PaystackRefundResponse;
    if (!response.ok || !body.status || !body.data) {
      return {
        refundReference: '',
        accepted: false,
        failureMessage: body.message ?? response.statusText,
      };
    }

    return { refundReference: String(body.data.id), accepted: true };
  }

  // Kenya bank-account vendor payouts (DisbursementsService) — a
  // recipient-then-transfer flow, matching Paystack's real Transfer API
  // shape. Vendor has no persisted recipient_code (see the Vendor model),
  // so a fresh recipient is created on every payout — infrequent enough
  // that this is simpler than caching one, at the cost of a redundant
  // Paystack-side recipient record per payout.
  //
  // TODO(verify against a real Paystack Kenya account, live not sandbox):
  // 'nuban' is Paystack's Nigerian bank-account recipient type — confirm
  // the correct recipient type/shape for KES transfers before relying on
  // this in production. Also unverified: some Paystack accounts require an
  // OTP step (POST /transfer/finalize_transfer) before a transfer actually
  // completes, which isn't handled here — a transfer Paystack returns as
  // 'otp'-pending will need manual finalization until that's built.
  async payBankAccountVendor(
    params: PayBankAccountVendorParams,
  ): Promise<VendorTransferResult> {
    const recipientResponse = await fetch(
      `${PAYSTACK_BASE_URL}/transferrecipient`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'nuban',
          name: params.accountName,
          account_number: params.accountNumber,
          bank_code: params.bankCode,
          currency: params.currency,
        }),
      },
    );
    const recipientBody =
      (await recipientResponse.json()) as PaystackTransferRecipientResponse;
    if (!recipientResponse.ok || !recipientBody.status || !recipientBody.data) {
      return {
        accepted: false,
        failureMessage:
          recipientBody.message ??
          'Could not create a Paystack transfer recipient for this vendor',
      };
    }

    const transferResponse = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(params.amount * 100),
        recipient: recipientBody.data.recipient_code,
        reference: params.transferId,
        reason: 'Vendor payout',
      }),
    });
    const transferBody =
      (await transferResponse.json()) as PaystackTransferResponse;
    if (!transferResponse.ok || !transferBody.status || !transferBody.data) {
      return {
        accepted: false,
        failureMessage: transferBody.message ?? 'Paystack transfer failed',
      };
    }

    return {
      accepted: true,
      providerReference: transferBody.data.reference ?? params.transferId,
    };
  }

  // Both charge and refund events land on the same webhook URL — checked
  // before parseWebhookEvent (which assumes a charge-shaped payload) so the
  // controller can route to the right queue/processor.
  isRefundEvent(rawBody: Buffer): boolean {
    const payload = JSON.parse(rawBody.toString('utf8')) as { event?: string };
    return !!payload.event?.startsWith('refund.');
  }

  parseRefundWebhookEvent(rawBody: Buffer): ParsedRefundWebhookEvent {
    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PaystackRefundWebhookPayload;
    const data = payload.data ?? { id: '' };

    return {
      refundReference: String(data.id),
      transactionReference:
        data.transaction_reference ?? data.transaction?.reference ?? '',
      succeeded: payload.event === 'refund.processed',
    };
  }

  // Disputes (chargebacks) also land on this same webhook URL — checked
  // alongside isRefundEvent, before parseWebhookEvent.
  isDisputeEvent(rawBody: Buffer): boolean {
    const payload = JSON.parse(rawBody.toString('utf8')) as { event?: string };
    return !!payload.event?.startsWith('charge.dispute');
  }

  parseDisputeWebhookEvent(rawBody: Buffer): ParsedDisputeWebhookEvent {
    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PaystackDisputeWebhookPayload;
    const data = payload.data ?? { id: '' };

    return {
      providerReference: String(data.id),
      transactionReference:
        data.transaction_reference ?? data.transaction?.reference ?? '',
      status: mapDisputeStatus(data.status),
      resolution: data.resolution ?? null,
      amount: (data.amount ?? 0) / 100,
      reason: data.category ?? null,
    };
  }

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    if (!signatureHeader) return false;

    const expected = createHmac(
      'sha512',
      this.config.get<string>('PAYSTACK_WEBHOOK_SECRET')!,
    )
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;

    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  async listBanks(): Promise<Bank[]> {
    const country = this.config.get<string>('PAYSTACK_COUNTRY');
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/bank?country=${encodeURIComponent(country!)}&currency=KES`,
      {
        headers: {
          Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        },
      },
    );

    const body = (await response.json()) as PaystackBankListResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack bank list failed: ${body.message ?? response.statusText}`,
      );
    }

    return body.data.map((b) => ({ name: b.name, code: b.code }));
  }

  async resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<ResolvedAccount> {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        },
      },
    );

    const body = (await response.json()) as PaystackResolveAccountResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Could not verify that account number: ${body.message ?? response.statusText}`,
      );
    }

    return {
      accountNumber: body.data.account_number,
      accountName: body.data.account_name,
    };
  }

  async createSubaccount(
    params: CreateSubaccountParams,
  ): Promise<SubaccountResult> {
    const response = await fetch(`${PAYSTACK_BASE_URL}/subaccount`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: params.businessName,
        settlement_bank: params.bankCode,
        account_number: params.accountNumber,
        percentage_charge: params.percentageCharge ?? 0,
      }),
    });

    const body = (await response.json()) as PaystackSubaccountResponse;
    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack subaccount creation failed: ${body.message ?? response.statusText}`,
      );
    }

    return { subaccountCode: body.data.subaccount_code };
  }

  parseWebhookEvent(rawBody: Buffer): ParsedWebhookEvent {
    const payload = JSON.parse(
      rawBody.toString('utf8'),
    ) as PaystackWebhookPayload;
    const data = payload.data ?? { reference: '' };
    const metadata = data.metadata ?? {};

    return {
      eventType: payload.event,
      providerReference: data.reference,
      amountSettled: (data.amount ?? 0) / 100,
      status: mapStatus(payload.event, data.status),
      paymentRail: mapChannel(data.channel),
      invoiceId: metadata.invoiceId,
      eventId: metadata.eventId,
      personalInvoiceId: metadata.personalInvoiceId,
      platformFeeAmount: metadata.platformFeeAmount
        ? Number(metadata.platformFeeAmount)
        : undefined,
      provider: 'PAYSTACK',
      currency: data.currency ?? 'KES',
    };
  }
}

function mapStatus(eventType: string, dataStatus?: string): TransactionStatus {
  if (eventType === 'charge.success' || dataStatus === 'success')
    return TransactionStatus.SUCCESS;
  if (dataStatus === 'failed' || eventType === 'charge.failed')
    return TransactionStatus.FAILED;
  return TransactionStatus.PENDING;
}

function mapChannel(channel?: string): PaymentRail {
  if (channel === 'mobile_money' || channel === 'ussd')
    return PaymentRail.MOBILE_MONEY;
  return PaymentRail.CARD;
}

function mapDisputeStatus(status?: string): DisputeStatus {
  switch (status) {
    case 'awaiting-bank-feedback':
      return DisputeStatus.AWAITING_BANK_FEEDBACK;
    case 'resolved':
      return DisputeStatus.RESOLVED;
    case 'pending':
      return DisputeStatus.PENDING;
    case 'awaiting-merchant-feedback':
    default:
      return DisputeStatus.AWAITING_MERCHANT_FEEDBACK;
  }
}
