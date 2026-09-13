import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type {
  Bank,
  BankPayoutProvider,
  CreateSubaccountParams,
  InitializeChargeParams,
  InitializeChargeResult,
  ParsedWebhookEvent,
  PaymentProvider,
  ResolvedAccount,
  SubaccountResult,
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

@Injectable()
export class PaystackProvider implements PaymentProvider, BankPayoutProvider {
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
