// Self-tests of the fake gateway: the signature rules, the documented test vectors, validation, idempotency, error
// injection and the webhook sender.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LIVE_KEY,
  LIVE_SECRET,
  TEST_KEY,
  TEST_PREVIOUS_SECRET,
  TEST_SECRET,
  sendWebhook,
  signApiRequest,
  signCheckoutPayload,
  signWebhook,
  startFakeGateway,
  verifyCheckoutToken,
  webhookBody,
  type FakeGateway,
} from '../src/fake-gateway/index.ts';
import { merchantExample, merchantOperations, successStatuses, validateMerchantApi } from '../src/internal/contract.ts';
import { FORWARD_CASES } from '../src/conformance/cases.ts';

const DOCS_SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';

interface Signed {
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, unknown> | null;
}

async function signed(
  gateway: FakeGateway,
  method: string,
  target: string,
  body = '',
  extra: Record<string, string> = {},
  secret = TEST_SECRET,
): Promise<Signed> {
  const timestamp = extra['x-api-timestamp'] ?? String(Math.floor(Date.now() / 1000));
  const nonce = extra['x-api-nonce'] ?? randomUUID();
  const { signature } = signApiRequest({ secret, method, target, timestamp, nonce, body });
  const res = await fetch(`${gateway.url}${target}`, {
    method,
    headers: {
      'x-api-key': TEST_KEY,
      'x-api-timestamp': timestamp,
      'x-api-nonce': nonce,
      'x-api-signature': signature,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    body: body || undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

describe('signing helpers against the documented test vectors', () => {
  it('gateway 13.5: vector 1 (POST with a body) and vector 2 (GET)', () => {
    const body =
      '{"externalId":"order-10530","network":"tron","asset":"USDT","amount":"50","description":"Заказ 10530","metadata":{"orderId":"10530"}}';
    expect(
      signApiRequest({
        secret: DOCS_SECRET,
        method: 'POST',
        target: '/api/v1/invoices',
        timestamp: '1790683200',
        nonce: '6f1c2a9e-4b7d-4e21-9a3c-8d5f0b2e7c41',
        body,
      }).signature,
    ).toBe('v1=e2fda22d1cbec087e2edc769f9bfc2368c29fd43aff2f36822fa19d9396463d9');
    expect(
      signApiRequest({
        secret: DOCS_SECRET,
        method: 'GET',
        target: '/api/v1/invoices?status=active,partially_paid&limit=20',
        timestamp: '1790683260',
        nonce: 'b2d4f6a8-1c3e-4f50-8a7b-9c0d1e2f3a4b',
        body: '',
      }).signature,
    ).toBe('v1=e336ed5f635db2db5de16f78a38feb28c86dd5245a0d92a2f2cf0f54e503d5f9');
  });

  it('webhook-service 13.6: the webhook.test example', () => {
    const body =
      '{"id":"0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f","type":"webhook.test","version":1,"occurredAt":"2026-09-29T12:20:00.214Z","network":"tron","chain":"nile","merchantId":"6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13","data":{"test":true,"message":"Проверка после смены URL"}}';
    expect(signWebhook(DOCS_SECRET, 1790684400, body)).toBe(
      'v1=e35e9b0ea7e02ffcff516436483fedda7b1b01e16c65e3d4a7a61274670df250',
    );
  });

  it('gateway 20.4: both token vectors verify; another secret or prefix does not', () => {
    const p2 =
      'eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwfQ';
    expect(signCheckoutPayload(DOCS_SECRET, p2)).toBe('guQrxJw9m2RlbNRkL3FPI08BJHsr_WzByGV6XPXrlak');
    expect(verifyCheckoutToken(`v1.${p2}.guQrxJw9m2RlbNRkL3FPI08BJHsr_WzByGV6XPXrlak`, DOCS_SECRET)).toEqual({
      valid: true,
      payload: { k: 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp', i: '97da92f5-45c0-411b-9ed5-6793b396cd5f', e: 1790769600 },
    });
    const p1 =
      'eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwLCJiIjp7ImNvbXBhbnlOYW1lIjoiU2hvcCBFeGFtcGxlIiwibG9nb1VybCI6Imh0dHBzOi8vc2hvcC5leGFtcGxlL2xvZ28ucG5nIiwiYWNjZW50Q29sb3IiOiIjNGY0NmU1IiwidGhlbWUiOiJhdXRvIiwidGl0bGUiOiLQl9Cw0LrQsNC3IDEwNTMwIn0sImwiOiJydSJ9';
    expect(verifyCheckoutToken(`v1.${p1}.IzC8fVLRewHK1Xx33zRBoVFi1aMIHgRxJdk5C0vb70Y`, DOCS_SECRET)).toMatchObject({
      valid: true,
      payload: { l: 'ru', b: { companyName: 'Shop Example', title: 'Заказ 10530' } },
    });
    expect(verifyCheckoutToken(`v1.${p2}.R2Sq_oZLnUaUvY2MI6am92r3ssIx5DjdyKw86qjtAKo`, DOCS_SECRET)).toMatchObject({
      valid: false,
      reason: 'bad_signature',
    });
    expect(verifyCheckoutToken(`v1.${p2}.DtreNmaTLcNJkb-XLLyIzHH3Rl2X8zhwxbFIvfGDthw`, DOCS_SECRET)).toMatchObject({
      valid: false,
    });
  });
});

describe('fake gateway', () => {
  let gateway: FakeGateway;
  beforeAll(async () => {
    gateway = await startFakeGateway();
  });
  afterAll(() => gateway.close());
  beforeEach(() => gateway.reset());

  describe('signature (gateway 13.4)', () => {
    it('accepts a correctly signed request and records it', async () => {
      const res = await signed(gateway, 'GET', '/api/v1/account');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(gateway.requests).toHaveLength(1);
      expect(gateway.requests[0]).toMatchObject({
        operationId: 'getAccount',
        auth: { ok: true },
        response: { status: 200 },
      });
    });

    it('refuses another secret with bad_signature and its string to sign', async () => {
      const res = await signed(gateway, 'GET', '/api/v1/account', '', {}, TEST_PREVIOUS_SECRET);
      expect(res.status).toBe(401);
      expect(res.json).toMatchObject({
        errorCode: 'api_auth_failed',
        details: { reason: 'bad_signature', stringToSign: expect.stringMatching(/^v1\nGET\n\/api\/v1\/account\n/) },
      });
    });

    it('refuses a reused nonce, a missing or malformed header, an old timestamp and an unknown key', async () => {
      const nonce = randomUUID();
      expect((await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-nonce': nonce })).status).toBe(200);
      expect((await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-nonce': nonce })).json).toMatchObject({
        details: { reason: 'nonce_reused' },
      });
      expect((await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-signature': '' })).json).toMatchObject({
        details: { reason: 'missing_header', header: 'x-api-signature' },
      });
      expect((await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-nonce': 'short' })).json).toMatchObject({
        details: { reason: 'malformed_header', header: 'x-api-nonce' },
      });
      const old = String(Math.floor(Date.now() / 1000) - 400);
      expect((await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-timestamp': old })).json).toMatchObject({
        details: { reason: 'timestamp_out_of_window' },
      });
      expect(
        (await signed(gateway, 'GET', '/api/v1/tariff', '', { 'x-api-key': 'psp_pk_test_000000000000000000000000' }))
          .json,
      ).toMatchObject({
        details: { reason: 'unknown_key' },
      });
      expect(gateway.requests.map((r) => r.auth.ok)).toEqual([true, false, false, false, false, false]);
    });

    it('signs the query byte for byte: an encoded comma is another target', async () => {
      const res = await signed(gateway, 'GET', '/api/v1/invoices?status=active%2Cpartially_paid&limit=20');
      expect(res.status).toBe(200);
      expect(gateway.requests[0]?.target).toBe('/api/v1/invoices?status=active%2Cpartially_paid&limit=20');
      expect(gateway.requests[0]?.query).toContainEqual(['status', 'active,partially_paid']);
    });

    it('answers 404 not_found for a path outside the Merchant API', async () => {
      expect((await signed(gateway, 'GET', '/api/v1/nope')).json).toMatchObject({ errorCode: 'not_found' });
    });
  });

  describe('answers', () => {
    it.each(FORWARD_CASES.map((c) => [c.operationId, c] as const))(
      '%s: the documented example, valid by the schema',
      async (operationId, c) => {
        const target = c.merchantPath + (c.path.includes('?') ? c.path.slice(c.path.indexOf('?')) : '');
        const res = await signed(gateway, c.method, target, c.body === undefined ? '' : JSON.stringify(c.body));
        expect(successStatuses(operationId), res.text).toContain(res.status);
        const op = merchantOperations.find((o) => o.operationId === operationId);
        const pointer = `${op?.pointer}/responses/${res.status}/content/application~1json/schema`;
        expect(validateMerchantApi(pointer, res.json)).toEqual([]);
      },
    );

    it('the CSV statement is text/csv, the documented example', async () => {
      const res = await signed(gateway, 'GET', '/api/v1/operations/statement?format=csv');
      expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
      expect(res.text).toBe(merchantExample('getMerchantOperationsStatement', 200, 'text/csv'));
    });

    it('createInvoice: 201, then 200 with the same object, then 409 invoice_conflict for other fields', async () => {
      const body = { externalId: 'self-1', network: 'tron', asset: 'USDT', amount: '5' };
      const a = await signed(gateway, 'POST', '/api/v1/invoices', JSON.stringify(body));
      const b = await signed(gateway, 'POST', '/api/v1/invoices', JSON.stringify(body));
      const c = await signed(gateway, 'POST', '/api/v1/invoices', JSON.stringify({ ...body, amount: '6' }));
      expect([a.status, b.status, c.status]).toEqual([201, 200, 409]);
      expect(b.json).toEqual(a.json);
      expect(a.json).toMatchObject({ externalId: 'self-1', amount: '5' });
      expect(c.json).toMatchObject({ errorCode: 'invoice_conflict', details: { invoiceId: a.json?.['id'] } });
    });

    it('400 invalid_schema: an unknown parameter, an unknown body field, a missing field, a bad X-Client-Request-Id', async () => {
      expect((await signed(gateway, 'GET', '/api/v1/invoices?color=red')).json).toMatchObject({
        errorCode: 'invalid_schema',
        details: { fields: [{ field: 'color' }] },
      });
      expect(
        (
          await signed(
            gateway,
            'POST',
            '/api/v1/invoices',
            '{"externalId":"x","network":"tron","asset":"USDT","amount":"1","merchantId":"m"}',
          )
        ).status,
      ).toBe(400);
      expect((await signed(gateway, 'POST', '/api/v1/invoices', '{"externalId":"x"}')).status).toBe(400);
      expect(
        (await signed(gateway, 'GET', '/api/v1/account', '', { 'x-client-request-id': 'has space' })).json,
      ).toMatchObject({
        details: { fields: [{ field: 'x-client-request-id' }] },
      });
    });

    it('echoes a valid X-Client-Request-Id', async () => {
      const res = await signed(gateway, 'GET', '/api/v1/account', '', { 'x-client-request-id': 'req-1' });
      expect(res.headers.get('x-client-request-id')).toBe('req-1');
    });
  });

  describe('error injection', () => {
    it('the next call gets the reply, then the default again', async () => {
      gateway.inject('getAccount', {
        status: 429,
        json: { errorCode: 'too_many_requests', errorMessage: 'slow down', details: null },
        headers: { 'Retry-After': '3' },
      });
      const a = await signed(gateway, 'GET', '/api/v1/account');
      const b = await signed(gateway, 'GET', '/api/v1/account');
      expect([a.status, b.status]).toEqual([429, 200]);
      expect(a.headers.get('retry-after')).toBe('3');
      expect(gateway.requests[0]?.response?.headers['retry-after']).toBe('3');
    });

    it('injectError takes the documented example of the code', async () => {
      gateway.injectError('createInvoice', 'amount_out_of_range');
      const res = await signed(
        gateway,
        'POST',
        '/api/v1/invoices',
        '{"externalId":"x","network":"tron","asset":"USDT","amount":"1"}',
      );
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ errorCode: 'amount_out_of_range', details: { min: '11' } });
    });

    it("'always' answers until cleared; a function reply sees the request", async () => {
      gateway.inject(
        'getMerchantTariff',
        (req) => ({ status: 503, json: { errorCode: 'service_unavailable', errorMessage: req.target, details: null } }),
        { times: 'always' },
      );
      expect((await signed(gateway, 'GET', '/api/v1/tariff')).json).toMatchObject({ errorMessage: '/api/v1/tariff' });
      expect((await signed(gateway, 'GET', '/api/v1/tariff')).status).toBe(503);
      gateway.clearInjections();
      expect((await signed(gateway, 'GET', '/api/v1/tariff')).status).toBe(200);
    });

    it('a signature error wins over an injection', async () => {
      gateway.inject('getAccount', { status: 500, json: {} });
      expect((await signed(gateway, 'GET', '/api/v1/account', '', {}, TEST_PREVIOUS_SECRET)).status).toBe(401);
      expect((await signed(gateway, 'GET', '/api/v1/account')).status).toBe(500);
    });

    it('a delay and a closed connection', async () => {
      gateway.inject('getAccount', { delayMs: 300, json: merchantExample('getAccount', 200) });
      const started = performance.now();
      expect((await signed(gateway, 'GET', '/api/v1/account')).status).toBe(200);
      expect(performance.now() - started).toBeGreaterThanOrEqual(280);
      gateway.inject('getAccount', { destroy: true });
      await expect(signed(gateway, 'GET', '/api/v1/account')).rejects.toThrow();
      expect(gateway.requests.at(-1)?.response).toBeNull();
    });
  });
});

describe('webhook sender', () => {
  let url = '';
  const received: { headers: IncomingMessage['headers']; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
    });
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('signs the body with the secret over `${timestamp}.${body}`, headers match the body', async () => {
    const sent = await sendWebhook(url, {
      type: 'invoice.paid',
      id: 'c65065bb-9874-49d4-b44b-4930a167a5c1',
      timestamp: 1790683568,
    });
    expect(sent.status).toBe(200);
    const got = received.at(-1);
    expect(got?.body).toBe(sent.request.body);
    expect(got?.headers['x-webhook-signature']).toBe(signWebhook(TEST_SECRET, 1790683568, sent.request.body));
    expect(got?.headers).toMatchObject({
      'x-webhook-id': 'c65065bb-9874-49d4-b44b-4930a167a5c1',
      'x-webhook-event': 'invoice.paid',
      'x-webhook-attempt': '1',
    });
    const body = JSON.parse(sent.request.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: 'c65065bb-9874-49d4-b44b-4930a167a5c1',
      type: 'invoice.paid',
      version: 1,
      chain: 'nile',
    });
  });

  it('a previous secret, a forged signature, an omitted header, overridden fields', async () => {
    const prev = await sendWebhook(url, { secret: TEST_PREVIOUS_SECRET, timestamp: 1790683568 });
    expect(received.at(-1)?.headers['x-webhook-signature']).toBe(
      signWebhook(TEST_PREVIOUS_SECRET, 1790683568, prev.request.body),
    );
    await sendWebhook(url, { signature: 'v1=00' });
    expect(received.at(-1)?.headers['x-webhook-signature']).toBe('v1=00');
    await sendWebhook(url, { omitHeaders: ['X-Webhook-Timestamp'] });
    expect(received.at(-1)?.headers['x-webhook-timestamp']).toBeUndefined();
    await sendWebhook(url, { fields: { chain: 'mainnet' } });
    expect(JSON.parse(received.at(-1)?.body ?? '{}')).toMatchObject({ chain: 'mainnet' });
    expect(JSON.parse(webhookBody('webhook.test'))).toMatchObject({ type: 'webhook.test', data: { test: true } });
  });
});

describe('test credentials', () => {
  // A backend built on @qubiq-psp/sdk refuses a malformed key or secret at start, so every made-up credential must
  // have the platform's format: a key of 24 and a secret of 36 base62 characters after the prefix.
  it.each([
    ['TEST_KEY', TEST_KEY, /^psp_pk_test_[0-9A-Za-z]{24}$/],
    ['LIVE_KEY', LIVE_KEY, /^psp_pk_live_[0-9A-Za-z]{24}$/],
    ['TEST_SECRET', TEST_SECRET, /^psp_sk_test_[0-9A-Za-z]{36}$/],
    ['TEST_PREVIOUS_SECRET', TEST_PREVIOUS_SECRET, /^psp_sk_test_[0-9A-Za-z]{36}$/],
    ['LIVE_SECRET', LIVE_SECRET, /^psp_sk_live_[0-9A-Za-z]{36}$/],
  ])('%s has the platform format', (_name, value, re) => {
    expect(value).toMatch(re);
  });
});
