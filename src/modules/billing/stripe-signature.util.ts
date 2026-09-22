import { createHmac, timingSafeEqual } from 'node:crypto';

// A replayed webhook older than this is rejected even with a valid
// signature — mirrors Stripe's own recommended tolerance.
const TOLERANCE_SECONDS = 5 * 60;

// Stripe-Signature header shape: "t=<unix seconds>,v1=<hex hmac>[,v0=...]".
// Same HMAC + timingSafeEqual pattern as PaystackProvider.verifySignature,
// adapted to Stripe's timestamped scheme.
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader
      .split(',')
      .map((part) => part.split('=') as [string, string]),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
