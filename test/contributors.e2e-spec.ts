import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PAYMENT_PROVIDER } from '../src/modules/payments/providers/payment-provider.interface';
import { TransactionStatus } from '../generated/prisma/enums';
import { FakePaymentProvider } from './fakes/fake-payment-provider';

/**
 * Coverage for the public pledge/contributor-tracking feature: a contributor
 * self-pledges via a public, event-scoped endpoint (no secure token needed),
 * and the resulting invoice flows through the same partial-payment state
 * machine as an organizer-issued invoice. The authenticated summary exposes
 * phone numbers; the public one redacts them.
 */
describe('Contributor tracking (e2e)', () => {
  let app: INestApplication<App>;
  let fakeProvider: FakePaymentProvider;
  const runId = Date.now();
  const email = `contrib-${runId}@example.com`;
  const password = 'password123';

  let accessToken: string;
  let eventId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useFactory({
        factory: (config: ConfigService) => new FakePaymentProvider(config),
        inject: [ConfigService],
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    fakeProvider = moduleFixture.get(PAYMENT_PROVIDER);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Contributor Test Organizer' })
      .expect(201);
    accessToken = reg.body.accessToken;

    const org = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Contributor Test Org', type: 'OTHER' })
      .expect(201);

    const evt = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        organizationId: org.body.id,
        title: 'Test Wedding',
        isPermanent: false,
      })
      .expect(201);
    eventId = evt.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function sendSettledWebhook(
    invoiceId: string,
    amountMajorUnits: number,
  ) {
    const reference = `contrib_ref_${runId}_${Math.random().toString(36).slice(2)}`;
    fakeProvider.registerVerification(reference, {
      status: TransactionStatus.SUCCESS,
      amountSettled: amountMajorUnits,
      currency: 'KES',
    });

    const payload = {
      event: 'charge.success',
      data: {
        reference,
        amount: amountMajorUnits * 100,
        channel: 'mobile_money',
        status: 'success',
        metadata: { invoiceId, eventId },
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    await request(app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(rawBody)
      .expect(200);
  }

  async function pollUntil(
    check: () => Promise<boolean>,
    attempts = 30,
    delayMs = 250,
  ) {
    for (let i = 0; i < attempts; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async function invoiceStatus(invoiceId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return res.body.status;
  }

  it('rejects a pledge missing contributorPhone', async () => {
    await request(app.getHttpServer())
      .post(`/public/events/${eventId}/pledges`)
      .send({ contributorName: 'No Phone', amountPledged: 100 })
      .expect(400);
  });

  it('buckets pledges correctly across pledged, partially paid, and fully paid', async () => {
    const alice = await request(app.getHttpServer())
      .post(`/public/events/${eventId}/pledges`)
      .send({
        contributorName: 'Alice',
        contributorPhone: '+254700000001',
        amountPledged: 100,
      })
      .expect(201);

    const bob = await request(app.getHttpServer())
      .post(`/public/events/${eventId}/pledges`)
      .send({
        contributorName: 'Bob',
        contributorPhone: '+254700000002',
        amountPledged: 50,
      })
      .expect(201);

    const carol = await request(app.getHttpServer())
      .post(`/public/events/${eventId}/pledges`)
      .send({
        contributorName: 'Carol',
        contributorPhone: '+254700000003',
        amountPledged: 40,
      })
      .expect(201);
    expect(carol.body.source).toBe('PUBLIC_PLEDGE');

    // Alice pays in full, Bob pays half, Carol doesn't pay at all.
    await sendSettledWebhook(alice.body.id, 100);
    await sendSettledWebhook(bob.body.id, 25);
    await pollUntil(async () => {
      const [aliceStatus, bobStatus] = await Promise.all([
        invoiceStatus(alice.body.id),
        invoiceStatus(bob.body.id),
      ]);
      return aliceStatus !== 'PENDING' && bobStatus !== 'PENDING';
    });

    const authed = await request(app.getHttpServer())
      .get(`/invoices/contributors?eventId=${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(
      authed.body.buckets.fullyPaid.map((c: any) => c.contributorName),
    ).toEqual(['Alice']);
    expect(
      authed.body.buckets.partiallyPaid.map((c: any) => c.contributorName),
    ).toEqual(['Bob']);
    expect(
      authed.body.buckets.pledged.map((c: any) => c.contributorName),
    ).toEqual(['Carol']);
    expect(authed.body.buckets.pledged[0].source).toBe('PUBLIC_PLEDGE');
    expect(authed.body.buckets.partiallyPaid[0].remaining).toBe(25);
    expect(authed.body.totals.pledged).toBe(100 + 50 + 40);
    expect(authed.body.totals.received).toBe(100 + 25);
    expect(authed.body.buckets.fullyPaid[0].contributorPhone).toBe(
      '+254700000001',
    );
    expect(authed.body.text).toContain('Alice');

    const publicSummary = await request(app.getHttpServer())
      .get(`/public/events/${eventId}/contributors`)
      .expect(200);

    expect(
      publicSummary.body.buckets.fullyPaid[0].contributorPhone,
    ).toBeUndefined();
    expect(JSON.stringify(publicSummary.body)).not.toContain('+254700000001');
    expect(
      publicSummary.body.buckets.fullyPaid.map((c: any) => c.contributorName),
    ).toEqual(['Alice']);
  }, 15000);

  it('rejects unauthenticated access to the phone-including summary', async () => {
    await request(app.getHttpServer())
      .get(`/invoices/contributors?eventId=${eventId}`)
      .expect(401);
  });
});
