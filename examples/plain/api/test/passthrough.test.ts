import { request } from 'node:http';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSTHROUGH_ROUTES } from '../src/passthrough.ts';
import type { ExampleError, RequestLogEntry, RequestLogPage } from '../src/types.ts';
import { makeApp, SHOP_KEY, SHOP_SECRET, startStubPlatform, type StubPlatform, WRONG_SECRET } from './helpers.ts';

let stub: StubPlatform;
beforeAll(async () => {
  stub = await startStubPlatform();
});
afterAll(async () => {
  await stub.close();
});
beforeEach(() => {
  stub.seen.length = 0;
  stub.answer((req) => ({ status: 200, body: JSON.stringify({ method: req.method, url: req.url }) }));
});

const INVOICE = '97da92f5-45c0-411b-9ed5-6793b396cd5f';
const setup = (env: Record<string, string> = {}) =>
  makeApp({ PSP_API_URL: stub.url, APP_UPSTREAM_TIMEOUT_MS: '1000', ...env });

describe('passthrough routes', () => {
  it('every one of the 27 routes reaches its Merchant API path, signed', async () => {
    const { app } = await setup();
    expect(PASSTHROUGH_ROUTES).toHaveLength(27);
    for (const route of PASSTHROUGH_ROUTES) {
      const path = route.path.replace(/\{\w+\}/g, 'id-1');
      const res = await app.inject({
        method: route.method,
        url: path,
        ...(route.method === 'POST' || route.method === 'PUT' ? { payload: { a: 1 } } : {}),
      });
      expect(res.statusCode, `${route.method} ${path}`).toBe(200);
      const seen = stub.seen.at(-1)!;
      expect(seen.signatureOk).toBe(true);
      expect(`${seen.method} ${seen.url}`).toBe(`${route.method} ${path.replace('/api/', '/api/v1/')}`);
    }
  });

  it('forwards the query string and the body byte for byte; status, body and headers come back', async () => {
    const { app } = await setup();
    stub.answer((req) => ({
      status: req.headers['x-client-request-id'] === 'shop-req-1' ? 201 : 200,
      body: req.body.toString('utf8'),
      headers: { 'X-Api-Key-Deprecated': '2026-09-29T13:00:00.000Z', 'X-Other': 'not passed' },
    }));
    const body = '{ "externalId":"order-10530",  "description":"Заказ 10530", "unknown": [1,2] }';
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { 'content-type': 'application/json', 'x-client-request-id': 'shop-req-1', 'x-example-source': 'poll' },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe(body);
    expect(res.headers['x-request-id']).toBe('11111111-2222-4333-8444-555555555555');
    expect(res.headers['x-client-request-id']).toBe('shop-req-1');
    expect(res.headers['x-api-key-deprecated']).toBe('2026-09-29T13:00:00.000Z');
    expect(res.headers['x-other']).toBeUndefined();
    expect(res.headers['x-example-call-id']).toMatch(/^[0-9a-f-]{36}$/);
    const seen = stub.seen.at(-1)!;
    expect(seen.body.toString('utf8')).toBe(body);
    expect(seen.headers['x-example-source']).toBeUndefined();
    expect(seen.headers['content-type']).toBe('application/json');

    const query = '?status=active,partially_paid&limit=20&externalId=%D0%B7&unknown=x%2Cy';
    await app.inject({ method: 'GET', url: `/api/invoices${query}` });
    expect(stub.seen.at(-1)!.url).toBe(`/api/v1/invoices${query}`);
    expect(stub.seen.at(-1)!.signatureOk).toBe(true);
  });

  it('path ids are one percent-encoded segment', async () => {
    const { app } = await setup();
    await app.inject({ method: 'GET', url: '/api/invoices/a%2Fb%20c' });
    expect(stub.seen.at(-1)!.url).toBe('/api/v1/invoices/a%2Fb%20c');
  });

  it('a POST without a body is signed with the hash of the empty string', async () => {
    const { app } = await setup();
    await app.inject({ method: 'POST', url: `/api/invoices/${INVOICE}/cancel` });
    expect(stub.seen.at(-1)).toMatchObject({ signatureOk: true, body: Buffer.alloc(0) });
    expect(stub.seen.at(-1)!.headers['content-type']).toBeUndefined();
  });

  it('platform errors pass unchanged: 401 bad_signature with the string to sign, no WWW-Authenticate', async () => {
    const { app, log } = await setup({ PSP_API_SECRET: WRONG_SECRET });
    const res = await app.inject({ method: 'GET', url: '/api/account' });
    expect(res.statusCode).toBe(401);
    const body = res.json<{ errorCode: string; details: { reason: string; stringToSign: string } }>();
    expect(body.errorCode).toBe('api_auth_failed');
    expect(res.headers['www-authenticate']).toBeUndefined();
    const entry = log.get(log.page(() => true, 1, 1).items[0]!.id)!;
    // The same strings: the secret is wrong (see "Analysing bad_signature" in the platform documentation)
    expect(entry.signing?.stringToSign).toBe(body.details.stringToSign);
    expect(entry).toMatchObject({ status: 401, errorCode: 'api_auth_failed' });
  });

  it('429 and 503 keep Retry-After; the CSV statement stays text', async () => {
    const { app } = await setup();
    stub.answer(() => ({
      status: 503,
      headers: { 'Retry-After': '300' },
      body: JSON.stringify({ errorCode: 'maintenance', errorMessage: 'Maintenance', details: { message: null } }),
    }));
    const down = await app.inject({ method: 'GET', url: '/api/balances' });
    expect(down.statusCode).toBe(503);
    expect(down.headers['retry-after']).toBe('300');
    expect(down.json()).toMatchObject({ errorCode: 'maintenance' });

    stub.answer(() => ({
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body: 'a,b\n1,"Заказ"\n',
    }));
    const csv = await app.inject({ method: 'GET', url: '/api/operations/statement?format=csv&from=x' });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.body).toBe('a,b\n1,"Заказ"\n');
    expect(stub.seen.at(-1)!.headers['accept']).toBe('text/csv, application/json');
  });
});

describe('backend-own errors (example_*)', () => {
  it('400 before any platform call: bad JSON, bad X-Client-Request-Id, "." and ".." ids — with X-Example-Call-Id', async () => {
    const { app, log } = await setup();
    const expect400 = async (req: InjectOptions, field: string) => {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(400);
      expect(res.headers['x-example-call-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.json<ExampleError>()).toMatchObject({ errorCode: 'example_invalid_request', details: { field } });
    };
    const json = { 'content-type': 'application/json' };
    await expect400({ method: 'POST', url: '/api/invoices', headers: json, payload: '{"a":' }, 'body');
    await expect400(
      { method: 'POST', url: '/api/invoices', headers: { 'content-type': 'text/plain' }, payload: '{"a":1}' },
      'Content-Type',
    );
    await expect400(
      { method: 'GET', url: '/api/account', headers: { 'x-client-request-id': 'has space' } },
      'X-Client-Request-Id',
    );
    await expect400(
      { method: 'GET', url: '/api/account', headers: { 'x-client-request-id': 'x'.repeat(129) } },
      'X-Client-Request-Id',
    );
    await expect400({ method: 'GET', url: '/api/payouts/%2E' }, 'payoutId');
    await expect400({ method: 'GET', url: '/api/invoices//events' }, 'invoiceId');
    expect(stub.seen).toHaveLength(0);
    expect(log.page(() => true, 1, 50).total).toBe(0);
  });

  it('400 for a ".." id sent raw over HTTP (inject and fetch would resolve it themselves)', async () => {
    const { app } = await setup();
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          { host: address.hostname, port: address.port, path: '/api/invoices/%2E%2E/events', method: 'GET' },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(400);
      expect(stub.seen).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('504 example_upstream_timeout after APP_UPSTREAM_TIMEOUT_MS', async () => {
    const { app, log } = await setup();
    stub.answer(() => ({ status: 200, body: '{}', delayMs: 1200 }));
    const slow = await app.inject({ method: 'GET', url: '/api/account' });
    expect(slow.statusCode).toBe(504);
    expect(slow.json()).toEqual({
      errorCode: 'example_upstream_timeout',
      errorMessage: 'The platform did not answer in 1000 ms',
      details: { timeoutMs: 1000 },
    });
    expect(slow.headers['x-example-call-id']).toBeDefined();
    const entry = log.page((e) => e.operationId === 'getAccount', 1, 1).items[0]!;
    expect(entry).toMatchObject({ status: null, transportError: { code: 'timeout' } });
  });

  it('502 example_upstream_unreachable', async () => {
    const { app, log } = await makeApp({ PSP_API_URL: 'http://127.0.0.1:1' });
    const res = await app.inject({ method: 'GET', url: '/api/account' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      errorCode: 'example_upstream_unreachable',
      details: { cause: expect.any(String) },
    });
    expect(log.page(() => true, 1, 1).items[0]).toMatchObject({ status: null, transportError: { code: 'network' } });
  });

  it('502 example_upstream_bad_response: a redirect, a non-JSON error, an empty or non-JSON 2xx', async () => {
    const { app } = await setup();
    const bad = async (answer: Parameters<StubPlatform['answer']>[0], status: number) => {
      stub.answer(answer);
      const res = await app.inject({ method: 'GET', url: '/api/account' });
      expect(res.statusCode).toBe(502);
      const body = res.json<ExampleError>();
      expect(body.errorCode).toBe('example_upstream_bad_response');
      expect(body.details).toMatchObject({ status, requestId: '11111111-2222-4333-8444-555555555555' });
      return body;
    };
    await bad(() => ({ status: 302, headers: { Location: 'https://elsewhere.example' } }), 302);
    const html = await bad(
      () => ({ status: 502, headers: { 'Content-Type': 'text/html' }, body: '<h1>Bad Gateway</h1>' }),
      502,
    );
    expect(html.details).toMatchObject({ bodyPreview: '<h1>Bad Gateway</h1>' });
    await bad(() => ({ status: 200, body: '' }), 200);
    await bad(() => ({ status: 200, body: 'ok' }), 200);
    // CSV is fine for the statement only
    await bad(() => ({ status: 200, headers: { 'Content-Type': 'text/csv' }, body: 'a,b' }), 200);
  });

  it('404 example_not_found for an unknown route', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      errorCode: 'example_not_found',
      errorMessage: 'No route GET /api/nope',
      details: null,
    });
  });
});

describe('request log', () => {
  it('one entry per call: the contract fields, the signature headers, never the secret', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payouts/quote?x=1',
      headers: { 'x-client-request-id': 'q-1' },
      payload: { amount: '1' },
    });
    const callId = res.headers['x-example-call-id'] as string;
    const page = (await app.inject({ method: 'GET', url: `/api/request-log?callId=${callId}` })).json<RequestLogPage>();
    expect(page).toMatchObject({ page: 1, limit: 50, total: 1 });
    const item = page.items[0]!;
    expect(item).toEqual({
      id: item.id,
      callId,
      createdAt: item.createdAt,
      source: 'ui',
      operationId: 'quotePayout',
      sdkMethod: null,
      attempt: 1,
      method: 'POST',
      path: '/api/v1/payouts/quote?x=1',
      status: 200,
      errorCode: null,
      requestId: '11111111-2222-4333-8444-555555555555',
      clientRequestId: 'q-1',
      apiKeyDeprecatedUntil: null,
      durationMs: item.durationMs,
      transportError: null,
    });
    const entryRes = await app.inject({ method: 'GET', url: `/api/request-log/${item.id}` });
    const entry = entryRes.json<RequestLogEntry>();
    expect(entry).toMatchObject({
      ...item,
      url: `${stub.url}/api/v1/payouts/quote?x=1`,
      requestBody: '{"amount":"1"}',
      responseBodyTruncated: false,
    });
    expect(entry.requestHeaders).toMatchObject({ 'X-Api-Key': SHOP_KEY, 'X-Client-Request-Id': 'q-1' });
    expect(Object.keys(entry.requestHeaders)).toEqual(
      expect.arrayContaining(['X-Api-Timestamp', 'X-Api-Nonce', 'X-Api-Signature', 'User-Agent']),
    );
    expect(entry.responseHeaders?.['x-request-id']).toBe('11111111-2222-4333-8444-555555555555');
    expect(entry.signing?.stringToSign.split('\n').slice(0, 3)).toEqual(['v1', 'POST', '/api/v1/payouts/quote?x=1']);
    expect(entryRes.body).not.toContain(SHOP_SECRET);
  });

  it('filters, pages, newest first; 404 for an unknown entry; clear', async () => {
    const { app } = await setup();
    await app.inject({ method: 'GET', url: '/api/account' });
    await app.inject({ method: 'GET', url: '/api/balances', headers: { 'x-example-source': 'poll' } });
    stub.answer(() => ({
      status: 404,
      body: JSON.stringify({ errorCode: 'not_found', errorMessage: 'x', details: null }),
    }));
    await app.inject({ method: 'GET', url: `/api/invoices/${INVOICE}` });
    const list = async (query: string) =>
      (await app.inject({ method: 'GET', url: `/api/request-log${query}` })).json<RequestLogPage>();
    expect((await list('')).items.map((i) => i.operationId)).toEqual([
      'getInvoice',
      'getMerchantBalances',
      'getAccount',
    ]);
    expect((await list('?source=ui')).total).toBe(2);
    expect((await list('?source=poll')).items[0]?.operationId).toBe('getMerchantBalances');
    expect((await list('?status=4xx')).items[0]).toMatchObject({ status: 404, errorCode: 'not_found' });
    expect((await list('?status=2xx')).total).toBe(2);
    expect((await list('?status=error')).total).toBe(0);
    expect((await list('?operationId=getAccount')).total).toBe(1);
    expect(await list('?page=2&limit=2')).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      items: [{ operationId: 'getAccount' }],
    });
    for (const bad of ['?source=x', '?status=6xx', '?limit=201', '?page=0', '?callId=x', '?source=ui&source=poll']) {
      const res = await app.inject({ method: 'GET', url: `/api/request-log${bad}` });
      expect(res.statusCode, bad).toBe(400);
      expect(res.json<ExampleError>().errorCode).toBe('example_invalid_request');
    }
    const missing = await app.inject({ method: 'GET', url: `/api/request-log/${INVOICE}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ExampleError>().errorCode).toBe('example_not_found');
    expect((await app.inject({ method: 'DELETE', url: '/api/request-log' })).statusCode).toBe(204);
    expect((await list('')).total).toBe(0);
  });

  it('keeps APP_LOG_LIMIT entries; cuts response bodies to 256 KB', async () => {
    const { app } = await setup({ APP_LOG_LIMIT: '2' });
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: `/api/invoices?i=${i}` });
    const page = (await app.inject({ method: 'GET', url: '/api/request-log' })).json<RequestLogPage>();
    expect(page.items.map((i) => i.path)).toEqual(['/api/v1/invoices?i=2', '/api/v1/invoices?i=1']);

    stub.answer(() => ({ status: 200, body: JSON.stringify({ big: 'x'.repeat(300 * 1024) }) }));
    const big = await app.inject({ method: 'GET', url: '/api/account' });
    expect(big.body.length).toBeGreaterThan(300 * 1024);
    const id = (await app.inject({ method: 'GET', url: '/api/request-log?limit=1' })).json<RequestLogPage>().items[0]!
      .id;
    const entry = (await app.inject({ method: 'GET', url: `/api/request-log/${id}` })).json<RequestLogEntry>();
    expect(entry.responseBodyTruncated).toBe(true);
    expect(entry.responseBody).toHaveLength(256 * 1024);
  });

  it('cuts request bodies to 64 KB in the log; the platform gets the whole body', async () => {
    const { app } = await setup();
    stub.answer(() => ({ status: 200, body: '{}' }));
    const body = JSON.stringify({ pad: 'y'.repeat(100 * 1024) });
    await app.inject({
      method: 'POST',
      url: '/api/payouts/quote',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(stub.seen.at(-1)?.body.toString('utf8')).toBe(body);
    const id = (await app.inject({ method: 'GET', url: '/api/request-log?limit=1' })).json<RequestLogPage>().items[0]!
      .id;
    const entry = (await app.inject({ method: 'GET', url: `/api/request-log/${id}` })).json<RequestLogEntry>();
    expect(entry.requestBodyTruncated).toBe(true);
    expect(entry.requestBody).toBe(body.slice(0, 64 * 1024));
  });
});
