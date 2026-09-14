import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaystackProvider } from './paystack.provider';

function makeProvider(webhookSecret = 'test_webhook_secret') {
  const config = {
    get: (key: string) =>
      key === 'PAYSTACK_WEBHOOK_SECRET' ? webhookSecret : 'sk_test_x',
  } as unknown as ConfigService;
  return new PaystackProvider(config);
}

describe('PaystackProvider', () => {
  describe('verifySignature', () => {
    it('accepts a correctly signed payload', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const signature = createHmac('sha512', 'test_webhook_secret')
        .update(rawBody)
        .digest('hex');

      expect(provider.verifySignature(rawBody, signature)).toBe(true);
    });

    it('rejects a tampered payload', () => {
      const provider = makeProvider();
      const signedBody = Buffer.from(
        JSON.stringify({ event: 'charge.success' }),
      );
      const signature = createHmac('sha512', 'test_webhook_secret')
        .update(signedBody)
        .digest('hex');
      const tamperedBody = Buffer.from(
        JSON.stringify({ event: 'charge.success', amount: 999999 }),
      );

      expect(provider.verifySignature(tamperedBody, signature)).toBe(false);
    });

    it('rejects a signature produced with the wrong secret', () => {
      const provider = makeProvider('real_secret');
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const wrongSignature = createHmac('sha512', 'wrong_secret')
        .update(rawBody)
        .digest('hex');

      expect(provider.verifySignature(rawBody, wrongSignature)).toBe(false);
    });

    it('rejects when the signature header is missing', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      expect(provider.verifySignature(rawBody, undefined)).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('extracts reference, amount (major units), rail, and metadata', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference: 'ref_123',
            amount: 150000,
            channel: 'mobile_money',
            status: 'success',
            metadata: { invoiceId: 'inv_1', eventId: 'evt_1' },
          },
        }),
      );

      const parsed = provider.parseWebhookEvent(rawBody);

      expect(parsed.providerReference).toBe('ref_123');
      expect(parsed.amountSettled).toBe(1500);
      expect(parsed.paymentRail).toBe('MOBILE_MONEY');
      expect(parsed.status).toBe('SUCCESS');
      expect(parsed.invoiceId).toBe('inv_1');
      expect(parsed.eventId).toBe('evt_1');
    });

    it('extracts platformFeeAmount from metadata when present', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference: 'ref_123',
            amount: 101500,
            channel: 'card',
            status: 'success',
            metadata: { invoiceId: 'inv_1', platformFeeAmount: '15' },
          },
        }),
      );

      const parsed = provider.parseWebhookEvent(rawBody);

      expect(parsed.platformFeeAmount).toBe(15);
    });

    it('leaves platformFeeAmount undefined when absent (e.g. fee disabled)', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference: 'ref_123',
            amount: 100000,
            channel: 'card',
            status: 'success',
            metadata: { invoiceId: 'inv_1' },
          },
        }),
      );

      const parsed = provider.parseWebhookEvent(rawBody);

      expect(parsed.platformFeeAmount).toBeUndefined();
    });
  });

  describe('isRefundEvent / parseRefundWebhookEvent', () => {
    it('identifies a refund event and extracts its reference and outcome', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'refund.processed',
          data: { id: 555, transaction_reference: 'ref_123' },
        }),
      );

      expect(provider.isRefundEvent(rawBody)).toBe(true);
      const parsed = provider.parseRefundWebhookEvent(rawBody);
      expect(parsed.refundReference).toBe('555');
      expect(parsed.transactionReference).toBe('ref_123');
      expect(parsed.succeeded).toBe(true);
    });

    it('does not treat a charge event as a refund event', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      expect(provider.isRefundEvent(rawBody)).toBe(false);
    });

    it('reports a failed refund as not succeeded', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'refund.failed',
          data: { id: 555, transaction_reference: 'ref_123' },
        }),
      );

      expect(provider.parseRefundWebhookEvent(rawBody).succeeded).toBe(false);
    });
  });

  describe('isDisputeEvent / parseDisputeWebhookEvent', () => {
    it('identifies a dispute event and extracts its fields', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.dispute.create',
          data: {
            id: 42,
            status: 'awaiting-merchant-feedback',
            amount: 150000,
            category: 'fraud',
            transaction_reference: 'ref_123',
          },
        }),
      );

      expect(provider.isDisputeEvent(rawBody)).toBe(true);
      const parsed = provider.parseDisputeWebhookEvent(rawBody);
      expect(parsed.providerReference).toBe('42');
      expect(parsed.transactionReference).toBe('ref_123');
      expect(parsed.status).toBe('AWAITING_MERCHANT_FEEDBACK');
      expect(parsed.amount).toBe(1500);
      expect(parsed.reason).toBe('fraud');
      expect(parsed.resolution).toBeNull();
    });

    it('does not treat a charge or refund event as a dispute event', () => {
      const provider = makeProvider();
      expect(
        provider.isDisputeEvent(
          Buffer.from(JSON.stringify({ event: 'charge.success' })),
        ),
      ).toBe(false);
      expect(
        provider.isDisputeEvent(
          Buffer.from(JSON.stringify({ event: 'refund.processed' })),
        ),
      ).toBe(false);
    });

    it('maps a resolved dispute status and carries the resolution through', () => {
      const provider = makeProvider();
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.dispute.resolve',
          data: {
            id: 42,
            status: 'resolved',
            resolution: 'merchant-accepted',
            amount: 150000,
            transaction_reference: 'ref_123',
          },
        }),
      );

      const parsed = provider.parseDisputeWebhookEvent(rawBody);
      expect(parsed.status).toBe('RESOLVED');
      expect(parsed.resolution).toBe('merchant-accepted');
    });
  });
});
