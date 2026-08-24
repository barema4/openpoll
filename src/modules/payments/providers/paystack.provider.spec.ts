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
  });
});
