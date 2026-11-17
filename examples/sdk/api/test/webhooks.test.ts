// The receiver `POST /webhooks/psp` with the webhook vector of webhook-service docs 13.6, its log and settings.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, testEnv, type TestApp } from './support/app';

// The made-up secret of the docs (13.6), published on purpose. An old-format (testnet) secret; any testnet key fits.
const DOCS_SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const DOCS_KEY = 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
const OTHER_SECRET = 'psp_sk_test_Zz98Yy76Xx54Ww32Vv10Uu98Tt76Ss54Rr32';
const BODY =
  '{"id":"0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f","type":"webhook.test","version":1,"occurredAt":"2026-09-29T12:20:00.214Z","network":"tron","chain":"nile","merchantId":"6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13","data":{"test":true,"message":"Проверка после смены URL"}}';
const TIMESTAMP = 1790684400;
const SIGNATURE = 'v1=e35e9b0ea7e02ffcff516436483fedda7b1b01e16c65e3d4a7a61274670df250';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-Webhook-Id': '0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f',
  'X-Webhook-Event': 'webhook.test',
  'X-Webhook-Timestamp': String(TIMESTAMP),
  'X-Webhook-Signature': SIGNATURE,
  'X-Webhook-Attempt': '1',
};

/** The server clock, Unix seconds; the docs' attempt was signed at 1790684400. */
let clock = TIMESTAMP + 1;
let app: TestApp;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return testEnv('https://api.psp.test', { PSP_API_KEY: DOCS_KEY, PSP_API_SECRET: DOCS_SECRET, ...extra });
}

beforeAll(async () => {
  app = await startApp(env(), { now: () => clock * 1000 });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  clock = TIMESTAMP + 1;
  await fetch(`${app.url}/api/received-webhooks`, { method: 'DELETE' });
  await setReceiver({ mode: 'auto', status: 500, delayMs: 0, failNext: 0 });
});

async function deliver(
  target: TestApp,
  body: string | Buffer = BODY,
  headers: Record<string, string> = HEADERS,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${target.url}/webhooks/psp`, { method: 'POST', body, headers });
  return { status: res.status, json: await res.json() };
}

async function setReceiver(settings: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${app.url}/api/receiver`, {
    method: 'PUT',
    body: JSON.stringify(settings),
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, json: await res.json() };
}

interface Received {
  id: string;
  verifyResult: string;
  signedWith: string | null;
  duplicate: boolean;
  responseStatus: number;
  webhookId: string | null;
  event: string | null;
  attempt: number | null;
}

async function received(query = ''): Promise<{ items: Received[]; total: number }> {
  return (await (await fetch(`${app.url}/api/received-webhooks${query}`)).json()) as never;
}

describe('verification by the docs vector (webhook-service 13.6)', () => {
  it('accepts the valid webhook, then answers a repeat as a duplicate', async () => {
    expect(await deliver(app)).toEqual({ status: 200, json: { received: true, duplicate: false } });
    expect(await deliver(app)).toEqual({ status: 200, json: { received: true, duplicate: true } });

    const { items } = await received();
    expect(items.map((e) => [e.verifyResult, e.duplicate, e.responseStatus])).toEqual([
      ['ok', true, 200],
      ['ok', false, 200],
    ]);
    expect(items[1]).toMatchObject({
      webhookId: '0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f',
      event: 'webhook.test',
      attempt: 1,
      signedWith: 'current',
    });

    const detail = (await (await fetch(`${app.url}/api/received-webhooks/${items[1]?.id ?? ''}`)).json()) as {
      body: string;
      json: unknown;
      headers: Record<string, string>;
      verify: Record<string, unknown>;
      responseBody: string;
    };
    expect(detail.body).toBe(BODY);
    expect(detail.json).toEqual(JSON.parse(BODY));
    expect(detail.headers['x-webhook-signature']).toBe(SIGNATURE);
    expect(detail.verify).toEqual({
      result: 'ok',
      message: 'The webhook is valid',
      timestamp: TIMESTAMP,
      skewSeconds: 1,
      signatureValid: true,
      expectedSignature: SIGNATURE,
      bodyBytes: 279,
    });
    expect(JSON.parse(detail.responseBody)).toEqual({ received: true, duplicate: false });
  });

  it('one byte more: 401 signature_mismatch', async () => {
    const res = await deliver(app, `${BODY} `);
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ errorCode: 'signature_mismatch' });
    const [entry] = (await received()).items;
    expect(entry).toMatchObject({ verifyResult: 'signature_mismatch', signedWith: null, responseStatus: 401 });
  });

  it('server time 1790684701: 401 timestamp_out_of_window, the signature still shown as valid', async () => {
    clock = 1790684701;
    const res = await deliver(app);
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ errorCode: 'timestamp_out_of_window' });
    const [item] = (await received('?result=failed')).items;
    const detail = (await (await fetch(`${app.url}/api/received-webhooks/${item?.id ?? ''}`)).json()) as {
      verify: { signatureValid: boolean; skewSeconds: number };
      signedWith: string;
    };
    expect(detail.verify).toMatchObject({ signatureValid: true, skewSeconds: 301 });
    expect(detail.signedWith).toBe('current');
  });

  it.each([
    ['missing_header', 401, { 'X-Webhook-Signature': undefined }],
    ['bad_timestamp', 401, { 'X-Webhook-Timestamp': '17906844OO' }],
    ['bad_signature_header', 401, { 'X-Webhook-Signature': 'v2=abc' }],
    ['missing_header', 401, { 'X-Webhook-Id': undefined }],
    ['id_mismatch', 400, { 'X-Webhook-Id': 'another' }],
    ['type_mismatch', 400, { 'X-Webhook-Event': 'invoice.paid' }],
  ] as const)('%s → %i', async (reason, status, change) => {
    const headers: Record<string, string> = { ...HEADERS };
    for (const [name, value] of Object.entries(change)) {
      if (value === undefined) delete headers[name];
      else headers[name] = value;
    }
    const res = await deliver(app, BODY, headers);
    expect(res).toMatchObject({ status, json: { errorCode: reason, errorMessage: expect.any(String) } });
  });

  it('accepts a webhook signed with PSP_API_PREVIOUS_SECRET and reports it', async () => {
    const rotated = await startApp(env({ PSP_API_SECRET: OTHER_SECRET, PSP_API_PREVIOUS_SECRET: DOCS_SECRET }), {
      now: () => clock * 1000,
    });
    try {
      expect(await deliver(rotated)).toEqual({ status: 200, json: { received: true, duplicate: false } });
      const list = (await (await fetch(`${rotated.url}/api/received-webhooks`)).json()) as { items: Received[] };
      expect(list.items[0]).toMatchObject({ verifyResult: 'ok', signedWith: 'previous' });
      const config = (await (await fetch(`${rotated.url}/api/config`)).json()) as { previousSecretSet: boolean };
      expect(config.previousSecretSet).toBe(true);
    } finally {
      await rotated.close();
    }
  });
});

describe('receiver settings', () => {
  it('failNext forces the status for the next webhooks, then auto again', async () => {
    expect(await setReceiver({ mode: 'auto', status: 503, delayMs: 0, failNext: 1 })).toEqual({
      status: 200,
      json: { mode: 'auto', status: 503, delayMs: 0, failNext: 1 },
    });
    expect(await deliver(app)).toEqual({ status: 503, json: { forced: 'fail_next' } });
    expect(((await (await fetch(`${app.url}/api/receiver`)).json()) as { failNext: number }).failNext).toBe(0);
    // Not accepted with 2xx before: so not a duplicate now
    expect(await deliver(app)).toEqual({ status: 200, json: { received: true, duplicate: false } });
  });

  it('fixed always answers the status; a 2xx counts as accepted', async () => {
    await setReceiver({ mode: 'fixed', status: 500, delayMs: 0, failNext: 0 });
    expect(await deliver(app)).toEqual({ status: 500, json: { forced: 'fixed' } });
    expect(await deliver(app, 'not json')).toEqual({ status: 500, json: { forced: 'fixed' } });
    await setReceiver({ mode: 'fixed', status: 202, delayMs: 0, failNext: 0 });
    expect(await deliver(app)).toEqual({ status: 202, json: { forced: 'fixed' } });
    await setReceiver({ mode: 'auto', status: 500, delayMs: 0, failNext: 0 });
    expect(await deliver(app)).toEqual({ status: 200, json: { received: true, duplicate: true } });
  });

  it('delayMs pauses the answer', async () => {
    await setReceiver({ mode: 'auto', status: 500, delayMs: 150, failNext: 0 });
    const started = Date.now();
    await deliver(app);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    const [entry] = (await received()).items;
    expect(entry).toMatchObject({ responseDelayMs: 150 });
  });

  it.each([
    [null],
    [{ mode: 'auto', status: 500, delayMs: 0 }],
    [{ mode: 'sometimes', status: 500, delayMs: 0, failNext: 0 }],
    [{ mode: 'auto', status: 99, delayMs: 0, failNext: 0 }],
    [{ mode: 'auto', status: 500, delayMs: 30001, failNext: 0 }],
    [{ mode: 'auto', status: 500, delayMs: 0, failNext: 1.5 }],
    [{ mode: 'auto', status: 500, delayMs: 0, failNext: 0, extra: true }],
  ])('refuses %j', async (settings) => {
    expect(await setReceiver(settings)).toMatchObject({ status: 400, json: { errorCode: 'example_invalid_request' } });
  });
});

describe('received-webhooks log', () => {
  it('filters, pages, clears the log and the duplicate memory', async () => {
    await deliver(app);
    await deliver(app, `${BODY} `);
    expect((await received('?result=ok')).total).toBe(1);
    expect((await received('?result=failed')).total).toBe(1);
    expect((await received('?event=webhook.test')).total).toBe(2);
    expect((await received('?webhookId=nope')).total).toBe(0);
    expect((await received('?limit=1&page=2')).items).toHaveLength(1);
    expect((await (await fetch(`${app.url}/api/received-webhooks?result=maybe`)).json()) as object).toMatchObject({
      errorCode: 'example_invalid_request',
    });
    const missing = await fetch(`${app.url}/api/received-webhooks/97da92f5-45c0-411b-9ed5-6793b396cd5f`);
    expect(missing.status).toBe(404);

    expect((await fetch(`${app.url}/api/received-webhooks`, { method: 'DELETE' })).status).toBe(204);
    expect((await received()).total).toBe(0);
    expect(await deliver(app)).toEqual({ status: 200, json: { received: true, duplicate: false } });
  });
});

describe('memory bounds of the received-webhooks log (the receiver is open to anyone)', () => {
  it('a body over 64 KB: 413 example_payload_too_large, not logged', async () => {
    const res = await deliver(app, 'x'.repeat(64 * 1024 + 1));
    expect(res).toEqual({
      status: 413,
      json: {
        errorCode: 'example_payload_too_large',
        errorMessage: expect.any(String),
        details: { limitBytes: 65_536 },
      },
    });
    expect((await received()).total).toBe(0);
  });

  it('keeps 512 bytes of an unverified body, unparsed, in a ring of 100 that cannot push valid webhooks out', async () => {
    const small = await startApp(env({ APP_LOG_LIMIT: '5' }), { now: () => clock * 1000 });
    try {
      expect((await deliver(small)).status).toBe(200);
      const junk = JSON.stringify({ junk: 'y'.repeat(4000) });
      for (let i = 0; i < 120; i++) {
        const res = await deliver(small, junk, { 'Content-Type': 'application/json' });
        expect(res.status).toBe(401);
      }
      const list = (await (await fetch(`${small.url}/api/received-webhooks?limit=200`)).json()) as {
        items: Received[];
        total: number;
      };
      expect(list.total).toBe(101);
      expect(list.items.at(-1)?.webhookId).toBe(HEADERS['X-Webhook-Id']);
      const one = (await (await fetch(`${small.url}/api/received-webhooks/${list.items[0]?.id ?? ''}`)).json()) as {
        body: string;
        bodyTruncated: boolean;
        json: unknown;
        verify: { bodyBytes: number };
      };
      expect(one).toMatchObject({ bodyTruncated: true, json: null, verify: { bodyBytes: junk.length } });
      expect(one.body).toBe(junk.slice(0, 512));
    } finally {
      await small.close();
    }
  });
});
