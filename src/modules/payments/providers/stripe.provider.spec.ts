import { createHmac } from 'node:crypto';
import { StripeProvider } from './stripe.provider';
import {
  DisputeStatus,
  TransactionStatus,
} from '../../../../generated/prisma/enums';
import type { ConfigService } from '@nestjs/config';

function makeConfig(webhookSecret = 'whsec_test') {
  return {
    get: jest.fn((key: string) =>
      key === 'STRIPE_DONOR_WEBHOOK_SECRET' ? webhookSecret : 'sk_test_123',
    ),
  } as unknown as ConfigService;
}

describe('StripeProvider.verifySignature', () => {
  it('accepts a correctly signed payload', () => {
    const provider = new StripeProvider(makeConfig('whsec_test'));
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'checkout.session.completed' }),
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    expect(
      provider.verifySignature(rawBody, `t=${timestamp},v1=${signature}`),
    ).toBe(true);
  });

  it('rejects when STRIPE_DONOR_WEBHOOK_SECRET is unset', () => {
    const provider = new StripeProvider(makeConfig(undefined));
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'checkout.session.completed' }),
    );

    expect(provider.verifySignature(rawBody, 't=1,v1=bogus')).toBe(false);
  });
});

describe('StripeProvider.parseWebhookEvent', () => {
  it('parses a completed, paid checkout session into a SUCCESS event', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            payment_intent: 'pi_123',
            payment_status: 'paid',
            amount_total: 51500,
            currency: 'usd',
            metadata: {
              invoiceId: 'inv-1',
              eventId: 'event-1',
              platformFeeAmount: '15',
            },
          },
        },
      }),
    );

    const event = provider.parseWebhookEvent(rawBody);

    expect(event).toEqual(
      expect.objectContaining({
        providerReference: 'pi_123',
        amountSettled: 515,
        status: TransactionStatus.SUCCESS,
        invoiceId: 'inv-1',
        eventId: 'event-1',
        platformFeeAmount: 15,
      }),
    );
  });

  it('parses an unpaid session as PENDING', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            payment_intent: 'pi_123',
            payment_status: 'unpaid',
            amount_total: 1000,
            currency: 'usd',
            metadata: {},
          },
        },
      }),
    );

    expect(provider.parseWebhookEvent(rawBody).status).toBe(
      TransactionStatus.PENDING,
    );
  });
});

describe('StripeProvider.isRefundEvent / parseRefundWebhookEvent', () => {
  it('identifies a charge.refunded event', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'charge.refunded', data: { object: {} } }),
    );

    expect(provider.isRefundEvent(rawBody)).toBe(true);
  });

  it('does not misidentify a checkout completion as a refund', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: {} },
      }),
    );

    expect(provider.isRefundEvent(rawBody)).toBe(false);
  });

  it('parses a successful refund', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            payment_intent: 'pi_123',
            refunded: true,
            amount_refunded: 51500,
          },
        },
      }),
    );

    expect(provider.parseRefundWebhookEvent(rawBody)).toEqual({
      refundReference: 'ch_123',
      transactionReference: 'pi_123',
      succeeded: true,
    });
  });
});

describe('StripeProvider.isDisputeEvent / parseDisputeWebhookEvent', () => {
  it('identifies a charge.dispute.created event', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'charge.dispute.created', data: { object: {} } }),
    );

    expect(provider.isDisputeEvent(rawBody)).toBe(true);
  });

  it('parses a dispute event', () => {
    const provider = new StripeProvider(makeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_123',
            payment_intent: 'pi_123',
            status: 'needs_response',
            amount: 51500,
            reason: 'fraudulent',
          },
        },
      }),
    );

    expect(provider.parseDisputeWebhookEvent(rawBody)).toEqual({
      providerReference: 'dp_123',
      transactionReference: 'pi_123',
      status: DisputeStatus.AWAITING_MERCHANT_FEEDBACK,
      resolution: null,
      amount: 515,
      reason: 'fraudulent',
    });
  });
});
