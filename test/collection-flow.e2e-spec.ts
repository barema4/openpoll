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
 * End-to-end coverage of the Phase 1 core loop: register -> create org ->
 * create event -> create invoice -> simulate a signed Paystack webhook ->
 * confirm the transaction is persisted, the invoice flips to PAID, and a
 * redelivered webhook doesn't double-count (NFR-02 idempotency).
 *
 * The payment provider is overridden with a fake so the webhook processor's
 * server-side verify-transaction call (defense-in-depth against a spoofed
 * webhook) doesn't hit the real Paystack API in tests.
 */
describe('Collection flow (e2e)', () => {
  let app: INestApplication<App>;
  let fakeProvider: FakePaymentProvider;
  const runId = Date.now();
  const treasurerEmail = `treasurer-${runId}@example.com`;
  const password = 'password123';

  let accessToken: string;
  let eventId: string;
  let invoiceId: string;
  let providerReference: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user and returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: treasurerEmail, password, name: 'E2E Treasurer' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('creates an organization (creator becomes MAIN_ORGANIZER)', async () => {
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Church', type: 'CHURCH' })
      .expect(201);

    expect(res.body.memberships[0].role).toBe('MAIN_ORGANIZER');
  });

  it('creates a single-use event/invoice pair', async () => {
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Event Org', type: 'OTHER' })
      .expect(201);
    const organizationId = orgRes.body.id;

    const eventRes = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ organizationId, title: 'E2E Fundraiser', isPermanent: false })
      .expect(201);
    eventId = eventRes.body.id;

    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ eventId, amountRequested: 250, expiresInDays: 7 })
      .expect(201);
    invoiceId = invoiceRes.body.id;

    expect(invoiceRes.body.status).toBe('PENDING');
    expect(invoiceRes.body.expiresAt).not.toBeNull();
  });

  it('processes a signed webhook: persists the transaction and marks the invoice PAID', async () => {
    providerReference = `e2e_ref_${runId}`;
    fakeProvider.registerVerification(providerReference, {
      status: TransactionStatus.SUCCESS,
      amountSettled: 250,
      currency: 'KES',
    });

    const payload = {
      event: 'charge.success',
      data: {
        reference: providerReference,
        amount: 25000, // kobo -> 250.00
        channel: 'card',
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

    // Webhook processing is async (BullMQ) — poll briefly for the transaction to land.
    let invoice: any;
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      invoice = res.body;
      if (invoice.status === 'PAID') break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(invoice.status).toBe('PAID');

    const txRes = await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(txRes.body).toHaveLength(1);
    expect(txRes.body[0].providerReference).toBe(providerReference);
    expect(txRes.body[0].status).toBe('SUCCESS');
  }, 10000);

  it('rejects a webhook with an invalid signature', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'bogus' },
    });
    await request(app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'not-a-real-signature')
      .send(payload)
      .expect(400);
  });

  it('a redelivered webhook does not create a duplicate transaction', async () => {
    const payload = {
      event: 'charge.success',
      data: {
        reference: providerReference,
        amount: 25000,
        channel: 'card',
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

    // Give the queue a moment, then confirm the count never exceeds 1 even
    // after settling — there's nothing to "wait for" here since a duplicate
    // is a no-op, so a short fixed delay is enough (unlike the state-machine
    // transitions elsewhere in this file, there's no new terminal state to poll for).
    await new Promise((r) => setTimeout(r, 1000));

    const txRes = await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(txRes.body).toHaveLength(1);
  }, 10000);

  it('rejects unauthenticated access to a protected route', async () => {
    await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .expect(401);
  });
});

/**
 * Coverage for partial payments: a single-use invoice carries a fixed
 * amountRequested and accepts repeated partial webhook payments, moving
 * PENDING -> PARTIALLY_PAID -> PAID as the running total closes in on the
 * target — while a permanent link stays uncapped and open indefinitely.
 */
describe('Partial payments (e2e)', () => {
  let app: INestApplication<App>;
  let fakeProvider: FakePaymentProvider;
  const runId = Date.now();
  const email = `partial-${runId}@example.com`;
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
      .send({ email, password, name: 'Partial Payer' })
      .expect(201);
    accessToken = reg.body.accessToken;

    const org = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Partial Org', type: 'OTHER' })
      .expect(201);

    const evt = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        organizationId: org.body.id,
        title: 'Partial Event',
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
    const reference = `partial_ref_${runId}_${amountMajorUnits}_${Math.random().toString(36).slice(2)}`;
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
        channel: 'card',
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

  async function pollInvoice(
    invoiceId: string,
    until: (invoice: any) => boolean,
  ) {
    let invoice: any;
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer())
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      invoice = res.body;
      if (until(invoice)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return invoice;
  }

  it('allows creating a single-use invoice without an amountRequested (an open-amount link)', async () => {
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ eventId, isPermanent: false })
      .expect(201);

    expect(res.body.amountRequested).toBeNull();
    expect(res.body.expiresAt).not.toBeNull();
  });

  it('moves a single-use invoice through PARTIALLY_PAID to PAID across two webhooks', async () => {
    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ eventId, amountRequested: 300, expiresInDays: 7 })
      .expect(201);
    const invoiceId = invoiceRes.body.id;

    await sendSettledWebhook(invoiceId, 100);
    const afterFirst = await pollInvoice(
      invoiceId,
      (inv) => inv.status !== 'PENDING',
    );
    expect(afterFirst.status).toBe('PARTIALLY_PAID');
    expect(Number(afterFirst.amountPaid)).toBe(100);

    // A checkout attempt for more than the remaining balance (200) is rejected.
    await request(app.getHttpServer())
      .post(`/payments/checkout/${invoiceRes.body.secureToken}`)
      .send({ email: 'contributor@example.com', amount: 250 })
      .expect(400);

    await sendSettledWebhook(invoiceId, 200);
    const afterSecond = await pollInvoice(
      invoiceId,
      (inv) => inv.status === 'PAID',
    );
    expect(afterSecond.status).toBe('PAID');
    expect(Number(afterSecond.amountPaid)).toBe(300);

    const txRes = await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const invoiceTxs = txRes.body.filter((t: any) => t.invoiceId === invoiceId);
    expect(invoiceTxs).toHaveLength(2);

    // Fully paid — checkout is rejected outright now.
    await request(app.getHttpServer())
      .post(`/payments/checkout/${invoiceRes.body.secureToken}`)
      .send({ email: 'contributor@example.com', amount: 1 })
      .expect(400);
  }, 15000);

  it('leaves a permanent link uncapped and reusable across multiple webhooks', async () => {
    const linkRes = await request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ eventId, isPermanent: true, categoryTag: 'tithe' })
      .expect(201);
    const invoiceId = linkRes.body.id;
    expect(linkRes.body.expiresAt).toBeNull();

    await sendSettledWebhook(invoiceId, 50);
    await sendSettledWebhook(invoiceId, 75);

    let linkTxs: any[] = [];
    for (let i = 0; i < 30; i++) {
      const txRes = await request(app.getHttpServer())
        .get(`/transactions?eventId=${eventId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      linkTxs = txRes.body.filter((t: any) => t.invoiceId === invoiceId);
      if (linkTxs.length >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(linkTxs).toHaveLength(2);

    const invoiceRes = await request(app.getHttpServer())
      .get(`/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    // Permanent links never flip status regardless of how many payments land.
    expect(invoiceRes.body.status).toBe('PENDING');
  }, 15000);
});
