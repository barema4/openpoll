import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentRail,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type {
  InitializeChargeParams,
  InitializeChargeResult,
  ParsedWebhookEvent,
  PaymentProvider,
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

interface PaystackWebhookPayload {
  event: string;
  data?: {
    reference: string;
    amount?: number;
    channel?: string;
    status?: string;
    metadata?: { invoiceId?: string; eventId?: string };
  };
}

@Injectable()
export class PaystackProvider implements PaymentProvider {
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
          metadata: params.metadata,
          callback_url: params.callbackUrl,
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
