import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * End-to-end coverage of the Phase 1 core loop: register -> create org ->
 * create event -> create invoice -> simulate a signed Paystack webhook ->
 * confirm the transaction is persisted, the invoice flips to PAID, and a
 * redelivered webhook doesn't double-count (NFR-02 idempotency).
 */
describe('Collection flow (e2e)', () => {
  let app: INestApplication<App>;
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
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
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
  });

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

    await new Promise((r) => setTimeout(r, 500));

    const txRes = await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(txRes.body).toHaveLength(1);
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(app.getHttpServer())
      .get(`/transactions?eventId=${eventId}`)
      .expect(401);
  });
});
