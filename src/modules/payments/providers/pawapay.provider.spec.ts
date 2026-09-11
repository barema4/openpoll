import { ConfigService } from '@nestjs/config';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PawaPayProvider } from './pawapay.provider';
import { TransactionStatus } from '../../../../generated/prisma/enums';

function makeProvider(publicKeyPem?: string) {
  const config = {
    get: (key: string) =>
      key === 'PAWAPAY_PUBLIC_KEY' ? publicKeyPem : undefined,
  } as unknown as ConfigService;
  return new PawaPayProvider(config);
}

describe('PawaPayProvider.parseWebhookEvent', () => {
  it('maps a completed deposit callback into the shared ParsedWebhookEvent shape', () => {
    const provider = makeProvider();
    const rawBody = Buffer.from(
      JSON.stringify({
        depositId: 'dep_123',
        status: 'COMPLETED',
        amount: '15000',
        currency: 'UGX',
        metadata: [
          { fieldName: 'invoiceId', fieldValue: 'inv_1' },
          { fieldName: 'eventId', fieldValue: 'evt_1' },
        ],
      }),
    );

    const parsed = provider.parseWebhookEvent(rawBody);

    expect(parsed.providerReference).toBe('dep_123');
    expect(parsed.amountSettled).toBe(15000);
    expect(parsed.status).toBe(TransactionStatus.SUCCESS);
    expect(parsed.paymentRail).toBe('MOBILE_MONEY');
    expect(parsed.invoiceId).toBe('inv_1');
    expect(parsed.eventId).toBe('evt_1');
  });

  it('maps a failed deposit to FAILED status', () => {
    const provider = makeProvider();
    const rawBody = Buffer.from(
      JSON.stringify({
        depositId: 'dep_2',
        status: 'FAILED',
        amount: '500',
        currency: 'UGX',
      }),
    );

    expect(provider.parseWebhookEvent(rawBody).status).toBe(
      TransactionStatus.FAILED,
    );
  });

  it('maps an in-flight status (PROCESSING) to PENDING', () => {
    const provider = makeProvider();
    const rawBody = Buffer.from(
      JSON.stringify({
        depositId: 'dep_3',
        status: 'PROCESSING',
        amount: '500',
        currency: 'UGX',
      }),
    );

    expect(provider.parseWebhookEvent(rawBody).status).toBe(
      TransactionStatus.PENDING,
    );
  });
});

describe('PawaPayProvider.verifyWebhookSignature', () => {
  // A real ECDSA P-256 round trip: sign a request with a freshly generated
  // test key pair using the exact signature-base construction the RFC-9421
  // spec describes, then confirm the provider's independent reconstruction
  // + verification agrees. This proves the hand-written signature-base
  // logic is mechanically correct, independent of PawaPay's exact wire
  // format (flagged as unverified against a live account in the source).
  function signRequest(privateKeyPem: string, rawBody: Buffer) {
    const contentDigest = `sha-256=:${createHash('sha256').update(rawBody).digest('base64')}:`;
    const components = ['@method', '@path', 'content-digest'];
    const params = ';keyid="test-key";alg="ecdsa-p256-sha256"';

    const lines = [
      `"@method": POST`,
      `"@path": /payments/webhooks/pawapay`,
      `"content-digest": ${contentDigest}`,
      `"@signature-params": (${components.map((c) => `"${c}"`).join(' ')})${params}`,
    ];
    const signatureBase = lines.join('\n');

    const signature = createSign('SHA256')
      .update(signatureBase)
      .sign(privateKeyPem);
    const signatureInput = `sig1=(${components.map((c) => `"${c}"`).join(' ')})${params}`;
    const signatureHeader = `sig1=:${signature.toString('base64')}:`;

    return { contentDigest, signatureInput, signatureHeader };
  }

  function makeRequest(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): RawBodyRequest<Request> {
    return {
      rawBody,
      method: 'POST',
      url: '/payments/webhooks/pawapay',
      headers,
    } as unknown as RawBodyRequest<Request>;
  }

  it('accepts a correctly signed callback', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const publicKeyPem = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const privateKeyPem = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const rawBody = Buffer.from(
      JSON.stringify({ depositId: 'dep_1', status: 'COMPLETED' }),
    );
    const { contentDigest, signatureInput, signatureHeader } = signRequest(
      privateKeyPem,
      rawBody,
    );

    const provider = makeProvider(publicKeyPem);
    const request = makeRequest(rawBody, {
      'content-digest': contentDigest,
      'signature-input': signatureInput,
      signature: signatureHeader,
    });

    expect(provider.verifyWebhookSignature(request)).toBe(true);
  });

  it('rejects a tampered body (content-digest mismatch)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const publicKeyPem = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const privateKeyPem = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const rawBody = Buffer.from(
      JSON.stringify({ depositId: 'dep_1', status: 'COMPLETED' }),
    );
    const { signatureInput, signatureHeader } = signRequest(
      privateKeyPem,
      rawBody,
    );

    const tamperedBody = Buffer.from(
      JSON.stringify({ depositId: 'dep_1', status: 'FAILED' }),
    );
    const provider = makeProvider(publicKeyPem);
    const request = makeRequest(tamperedBody, {
      'content-digest': `sha-256=:${createHash('sha256').update(rawBody).digest('base64')}:`, // stale digest for the old body
      'signature-input': signatureInput,
      signature: signatureHeader,
    });

    expect(provider.verifyWebhookSignature(request)).toBe(false);
  });

  it('rejects a signature produced by a different key', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { privateKey: wrongPrivateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const publicKeyPem = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const wrongPrivateKeyPem = wrongPrivateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const rawBody = Buffer.from(
      JSON.stringify({ depositId: 'dep_1', status: 'COMPLETED' }),
    );
    const { contentDigest, signatureInput, signatureHeader } = signRequest(
      wrongPrivateKeyPem,
      rawBody,
    );

    const provider = makeProvider(publicKeyPem);
    const request = makeRequest(rawBody, {
      'content-digest': contentDigest,
      'signature-input': signatureInput,
      signature: signatureHeader,
    });

    expect(provider.verifyWebhookSignature(request)).toBe(false);
  });

  it('rejects when required headers are missing', () => {
    const provider = makeProvider(
      '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
    );
    const request = makeRequest(Buffer.from('{}'), {});

    expect(provider.verifyWebhookSignature(request)).toBe(false);
  });
});
