import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from './stripe-signature.util';

const SECRET = 'whsec_test_secret';

function sign(rawBody: Buffer, timestamp: number, secret = SECRET) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'customer.subscription.updated' }),
    );
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    expect(verifyStripeSignature(rawBody, header, SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signedBody = Buffer.from(JSON.stringify({ amount: 100 }));
    const header = sign(signedBody, Math.floor(Date.now() / 1000));
    const tamperedBody = Buffer.from(JSON.stringify({ amount: 999999 }));

    expect(verifyStripeSignature(tamperedBody, header, SECRET)).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', () => {
    const rawBody = Buffer.from(JSON.stringify({ amount: 100 }));
    const header = sign(rawBody, Math.floor(Date.now() / 1000), 'wrong_secret');

    expect(verifyStripeSignature(rawBody, header, SECRET)).toBe(false);
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const rawBody = Buffer.from(JSON.stringify({ amount: 100 }));
    const staleTimestamp = Math.floor(Date.now() / 1000) - 60 * 60;
    const header = sign(rawBody, staleTimestamp);

    expect(verifyStripeSignature(rawBody, header, SECRET)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const rawBody = Buffer.from(JSON.stringify({ amount: 100 }));

    expect(verifyStripeSignature(rawBody, undefined, SECRET)).toBe(false);
  });

  it('rejects a malformed header', () => {
    const rawBody = Buffer.from(JSON.stringify({ amount: 100 }));

    expect(verifyStripeSignature(rawBody, 'not-a-valid-header', SECRET)).toBe(
      false,
    );
  });
});
