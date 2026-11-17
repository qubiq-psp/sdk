import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../src/bus.ts';
import type { ExampleError, ReceivedWebhook, ReceivedWebhookPage, ReceiverSettings } from '../src/types.ts';
import { signWebhook } from '../src/webhook-verify.ts';
import { makeApp, OTHER_SECRET, SHOP_SECRET, WRONG_SECRET } from './helpers.ts';

const INVOICE_ID = '97da92f5-45c0-411b-9ed5-6793b396cd5f';

function paidBody(id: string, chain = 'nile'): string {
  return JSON.stringify({
    id,
    type: 'invoice.paid',
    version: 1,
    occurredAt: '2026-09-29T12:06:07.480Z',
    network: 'tron',
    chain,
    merchantId: '6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13',
    data: { invoice: { id: INVOICE_ID, externalId: 'order-10530', status: 'paid', description: 'Заказ 10530' } },
  });
}

function signedHeaders(id: string, body: string, secret = SHOP_SECRET, ts = Math.floor(Date.now() / 1000)) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'psp-webhooks/1.0',
    'x-webhook-id': id,
    'x-webhook-event': 'invoice.paid',
    'x-webhook-timestamp': String(ts),
    'x-webhook-signature': signWebhook(secret, String(ts), Buffer.from(body, 'utf8')),
    'x-webhook-attempt': '1',
  };
}

async function setup(env: Record<string, string> = {}) {
  const ctx = await makeApp(env);
  const hook = (id: string, body = paidBody(id), headers: Record<string, string> = signedHeaders(id, body)) =>
    ctx.app.inject({ method: 'POST', url: '/webhooks/psp', headers, payload: body });
  const list = async (query = '') =>
    (await ctx.app.inject({ method: 'GET', url: `/api/received-webhooks${query}` })).json<ReceivedWebhookPage>();
  const setReceiver = (settings: object) => ctx.app.inject({ method: 'PUT', url: '/api/receiver', payload: settings });
  return { ...ctx, hook, list, setReceiver };
}

describe('POST /webhooks/psp', () => {
  it('accepts a valid webhook, stores and streams it, answers 200; the repeat is a duplicate', async () => {
    const { app, hook, list, bus } = await setup();
    const events: StreamEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const id = 'c65065bb-9874-49d4-b44b-4930a167a5c1';
    const res = await hook(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, duplicate: false });
    expect(events).toMatchObject([{ type: 'webhook', item: { webhookId: id, invoiceId: INVOICE_ID } }]);

    expect((await hook(id)).json()).toEqual({ received: true, duplicate: true });

    const page = await list();
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ duplicate: true, verifyResult: 'ok', responseStatus: 200 });
    expect(page.items[1]).toEqual({
      id: page.items[1]!.id,
      receivedAt: page.items[1]!.receivedAt,
      webhookId: id,
      event: 'invoice.paid',
      attempt: 1,
      invoiceId: INVOICE_ID,
      externalId: 'order-10530',
      invoiceStatus: 'paid',
      verifyResult: 'ok',
      signedWith: 'current',
      duplicate: false,
      responseStatus: 200,
      responseDelayMs: 0,
    });
    const one = (
      await app.inject({ method: 'GET', url: `/api/received-webhooks/${page.items[1]!.id}` })
    ).json<ReceivedWebhook>();
    expect(one.body).toBe(paidBody(id));
    expect(one.json).toMatchObject({ id, type: 'invoice.paid' });
    expect(one.headers['x-webhook-event']).toBe('invoice.paid');
    expect(one.verify).toMatchObject({ result: 'ok', signatureValid: true, skewSeconds: expect.any(Number) });
    expect(one.verify.expectedSignature).toBe(one.headers['x-webhook-signature']);
    expect(one.responseBody).toBe('{"received":true,"duplicate":false}');
    expect(one.remoteIp).toBe('127.0.0.1');
  });

  it('a wrong secret: 401 signature_mismatch, stored with the reason; a failed one is not a duplicate later', async () => {
    const { hook, list } = await setup();
    const id = 'aa000000-0000-4000-8000-000000000001';
    const body = paidBody(id);
    const res = await hook(id, body, signedHeaders(id, body, WRONG_SECRET));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ errorCode: 'signature_mismatch', errorMessage: expect.any(String) });
    expect((await list('?result=failed')).items).toMatchObject([
      { verifyResult: 'signature_mismatch', responseStatus: 401, signedWith: null },
    ]);
    expect((await hook(id)).json()).toEqual({ received: true, duplicate: false });
  });

  it('400 for a body problem after a valid signature; 401 chain_mismatch for a mainnet webhook', async () => {
    const { hook } = await setup();
    const id = 'ab000000-0000-4000-8000-000000000001';
    const bad = paidBody(id).replace('"version":1', '"version":2');
    expect((await hook(id, bad, signedHeaders(id, bad))).statusCode).toBe(400);
    const mainnet = paidBody(id, 'mainnet');
    const res = await hook(id, mainnet, signedHeaders(id, mainnet));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ errorCode: 'chain_mismatch' });
  });

  it('accepts webhooks signed with PSP_API_PREVIOUS_SECRET as previous', async () => {
    const { hook, list } = await setup({ PSP_API_SECRET: OTHER_SECRET, PSP_API_PREVIOUS_SECRET: SHOP_SECRET });
    expect((await hook('ac000000-0000-4000-8000-000000000001')).statusCode).toBe(200);
    expect((await list()).items[0]).toMatchObject({ verifyResult: 'ok', signedWith: 'previous' });
  });

  it('reads any content type as raw bytes; stores a body that is not JSON', async () => {
    const { hook, list } = await setup();
    const id = 'cc000000-0000-4000-8000-000000000001';
    const body = paidBody(id);
    expect((await hook(id, body, { ...signedHeaders(id, body), 'content-type': 'text/plain' })).statusCode).toBe(200);
    const res = await hook(id, 'not json', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
    expect((await list()).items[0]).toMatchObject({ verifyResult: 'missing_header', webhookId: null, invoiceId: null });
  });
});

describe('receiver settings', () => {
  it('defaults; failNext counts down; fixed; delay', async () => {
    const { app, hook, list, setReceiver } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/receiver' })).json()).toEqual({
      mode: 'auto',
      status: 500,
      delayMs: 0,
      failNext: 0,
    });
    const id = 'bb000000-0000-4000-8000-000000000001';
    expect((await setReceiver({ mode: 'auto', status: 503, delayMs: 0, failNext: 2 })).json()).toEqual({
      mode: 'auto',
      status: 503,
      delayMs: 0,
      failNext: 2,
    });
    const first = await hook(id);
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ forced: 'fail_next' });
    expect((await app.inject({ method: 'GET', url: '/api/receiver' })).json<ReceiverSettings>().failNext).toBe(1);
    expect((await hook(id)).statusCode).toBe(503);
    // The forced failures did not accept it: the next one is not a duplicate
    expect((await hook(id)).json()).toEqual({ received: true, duplicate: false });

    await setReceiver({ mode: 'fixed', status: 410, delayMs: 300, failNext: 0 });
    const started = Date.now();
    const fixed = await hook('bb000000-0000-4000-8000-000000000002');
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(fixed.statusCode).toBe(410);
    expect(fixed.json()).toEqual({ forced: 'fixed' });
    expect((await list()).items[0]).toMatchObject({ responseStatus: 410, responseDelayMs: 300, verifyResult: 'ok' });
  });

  it('refuses incomplete or out-of-range settings', async () => {
    const { setReceiver } = await setup();
    const cases: [object, string][] = [
      [{ mode: 'auto', status: 500, delayMs: 0 }, 'failNext'],
      [{ mode: 'loud', status: 500, delayMs: 0, failNext: 0 }, 'mode'],
      [{ mode: 'auto', status: 199, delayMs: 0, failNext: 0 }, 'status'],
      [{ mode: 'auto', status: 500, delayMs: 30_001, failNext: 0 }, 'delayMs'],
      [{ mode: 'auto', status: 500, delayMs: 0, failNext: 1.5 }, 'failNext'],
      [{ mode: 'auto', status: 500, delayMs: 0, failNext: 0, extra: 1 }, 'extra'],
    ];
    for (const [settings, field] of cases) {
      const res = await setReceiver(settings);
      expect(res.statusCode).toBe(400);
      expect(res.json<ExampleError>()).toMatchObject({ errorCode: 'example_invalid_request', details: { field } });
    }
  });
});

describe('received-webhooks log', () => {
  it('filters, 404, clear (and the duplicate memory with it), the limit', async () => {
    const { app, hook, list } = await setup({ APP_LOG_LIMIT: '3' });
    await hook('dd000000-0000-4000-8000-000000000001');
    expect((await list(`?invoiceId=${INVOICE_ID}`)).total).toBe(1);
    expect((await list('?invoiceId=other')).total).toBe(0);
    expect((await list('?webhookId=dd000000-0000-4000-8000-000000000001')).total).toBe(1);
    expect((await list('?event=invoice.paid&result=ok')).total).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/received-webhooks?result=x' })).statusCode).toBe(400);
    const missing = await app.inject({ method: 'GET', url: `/api/received-webhooks/${INVOICE_ID}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ExampleError>().errorCode).toBe('example_not_found');

    expect((await app.inject({ method: 'DELETE', url: '/api/received-webhooks' })).statusCode).toBe(204);
    expect((await list()).total).toBe(0);
    expect((await hook('dd000000-0000-4000-8000-000000000001')).json()).toEqual({ received: true, duplicate: false });

    for (let i = 2; i <= 5; i++) await hook(`dd000000-0000-4000-8000-00000000000${i}`);
    const page = await list();
    expect(page.total).toBe(3);
    expect(page.items[0]?.webhookId).toBe('dd000000-0000-4000-8000-000000000005');
  });
});
