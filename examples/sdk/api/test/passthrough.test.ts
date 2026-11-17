// The passthrough routes against a local stub of the platform: every contract route calls its SDK method, and the
// platform's status, body and headers come back unchanged; the request log records every attempt.
import { request } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import routes from '@psp-examples/contract/routes.json';
import { API_KEY, API_SECRET, startApp, testEnv, type TestApp } from './support/app';
import { PlatformStub } from './support/platform-stub';

const ID = '97da92f5-45c0-411b-9ed5-6793b396cd5f';
const PASSTHROUGH = routes.filter((route) => route.merchantApi !== null);

/** The Merchant API path of a contract path: `/api/invoices/{invoiceId}` → `/api/v1/invoices/<ID>`. */
const merchantPath = (path: string): string => path.replace(/^\/api\//, '/api/v1/').replace(/\{\w+\}/g, ID);

let stub: PlatformStub;
let app: TestApp;

beforeAll(async () => {
  stub = await new PlatformStub().start();
  app = await startApp(testEnv(stub.url));
});
afterAll(async () => {
  await app.close();
  await stub.stop();
});
beforeEach(async () => {
  await fetch(`${app.url}/api/request-log`, { method: 'DELETE' });
});

interface Call {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

async function call(
  method: string,
  path: string,
  init: { body?: string; headers?: Record<string, string> } = {},
): Promise<Call> {
  // fetch would resolve `%2E%2E` as `..`: such a path goes over node:http as it is
  if (path.includes('%2E')) return rawCall(method, path);
  const res = await fetch(`${app.url}${path}`, {
    method,
    body: init.body,
    headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

function rawCall(method: string, path: string): Promise<Call> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(app.url);
    const req = request({ hostname, port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers))
          if (typeof value === 'string') headers.set(name, value);
        resolve({ status: res.statusCode ?? 0, headers, text, json: JSON.parse(text) as unknown });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

interface LogItem {
  id: string;
  callId: string;
  operationId: string;
  sdkMethod: string;
  attempt: number;
  status: number | null;
  source: string;
  path: string;
  errorCode: string | null;
  requestId: string | null;
  clientRequestId: string | null;
  transportError: { code: string } | null;
}

async function logOf(callId: string): Promise<LogItem[]> {
  const res = await call('GET', `/api/request-log?callId=${callId}`);
  return (res.json as { items: LogItem[] }).items;
}

describe('every passthrough route', () => {
  it('covers the 27 operations', () => {
    expect(PASSTHROUGH).toHaveLength(27);
  });

  it.each(PASSTHROUGH)('$method $path calls psp.$sdkMethod', async (route) => {
    const csv = route.operationId === 'getMerchantOperationsStatement';
    stub.answer({ status: 200, body: { route: route.operationId } });
    const path = route.path.replace(/\{\w+\}/g, ID);
    const body = route.method === 'PUT' ? JSON.stringify({ url: 'https://shop.test/hook' }) : undefined;
    const res = await call(route.method, csv ? `${path}?from=2026-11-01` : path, { body });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ route: route.operationId });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe(route.method);
    expect(stub.requests[0]?.target.split('?')[0]).toBe(merchantPath(route.path));

    const callId = res.headers.get('x-example-call-id') ?? '';
    expect(callId).toMatch(/^[0-9a-f-]{36}$/);
    const log = await logOf(callId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      callId,
      operationId: route.merchantApi,
      sdkMethod: route.sdkMethod,
      attempt: 1,
      method: route.method,
      status: 200,
      source: 'ui',
    });
  });
});

describe('request', () => {
  it('forwards the JSON body as parsed, and no body when none came', async () => {
    stub.answer({ status: 201, body: { id: ID } });
    const body = { externalId: 'order-1', network: 'tron', asset: 'USDT', amount: '50', extra: [1, 'x'] };
    await call('POST', '/api/invoices', { body: JSON.stringify(body) });
    expect(JSON.parse(stub.requests[0]?.body ?? '')).toEqual(body);
    expect(stub.requests[0]?.headers['content-type']).toBe('application/json');

    stub.answer({ status: 200, body: { id: ID } });
    await call('POST', `/api/invoices/${ID}/cancel`);
    expect(stub.requests[0]?.body).toBe('');
    expect(stub.requests[0]?.headers['content-type']).toBeUndefined();
  });

  it('forwards every query parameter, a comma list with literal commas', async () => {
    stub.answer({ status: 200, body: { items: [] } });
    await call('GET', '/api/invoices?status=active,partially_paid&limit=20&unknownParam=x%20y');
    expect(stub.requests[0]?.target).toBe('/api/v1/invoices?status=active,partially_paid&limit=20&unknownParam=x%20y');
  });

  it('puts a path id into one percent-encoded segment', async () => {
    stub.answer({ status: 404, body: { errorCode: 'not_found', errorMessage: 'no', details: null } });
    await call('GET', '/api/invoices/a%2Fb%3Fc');
    expect(stub.requests[0]?.target).toBe('/api/v1/invoices/a%2Fb%3Fc');
  });

  it('forwards X-Client-Request-Id, not X-Example-Source; poll marks the log entries', async () => {
    stub.answer({ status: 200, body: {}, headers: { 'X-Client-Request-Id': 'ui-42' } });
    const res = await call('GET', '/api/account', {
      headers: { 'X-Client-Request-Id': 'ui-42', 'X-Example-Source': 'poll' },
    });
    expect(stub.requests[0]?.headers['x-client-request-id']).toBe('ui-42');
    expect(stub.requests[0]?.headers['x-example-source']).toBeUndefined();
    expect(res.headers.get('x-client-request-id')).toBe('ui-42');
    const [entry] = await logOf(res.headers.get('x-example-call-id') ?? '');
    expect(entry).toMatchObject({ source: 'poll', clientRequestId: 'ui-42' });

    const ui = (await call('GET', '/api/request-log?source=ui')).json as { total: number };
    expect(ui.total).toBe(0);
  });

  it('PUT /api/webhook sends only url (psp.webhook.setUrl)', async () => {
    stub.answer({ status: 202, body: { url: 'https://shop.test/hook', sync: { state: 'pending' } } });
    const res = await call('PUT', '/api/webhook', { body: JSON.stringify({ url: 'https://shop.test/hook', x: 1 }) });
    expect(res.status).toBe(202);
    expect(JSON.parse(stub.requests[0]?.body ?? '')).toEqual({ url: 'https://shop.test/hook' });
  });

  describe('refused before any platform call: 400 example_invalid_request with the call id', () => {
    it.each([
      ['a body that is not JSON', 'POST', '/api/invoices', { body: '{"amount":', headers: {} }],
      ['an X-Client-Request-Id with a space', 'GET', '/api/account', { headers: { 'X-Client-Request-Id': 'a b' } }],
      ['a path id ..', 'GET', '/api/invoices/%2E%2E', {}],
    ] as const)('%s', async (_name, method, path, init) => {
      stub.answer({ status: 200, body: {} });
      const res = await call(method, path, init);
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ errorCode: 'example_invalid_request', details: { field: expect.any(String) } });
      expect(res.headers.get('x-example-call-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(stub.requests).toHaveLength(0);
    });
  });
});

describe('response', () => {
  it('keeps 201 of a new invoice and 200 of an idempotent repeat', async () => {
    stub.answer({ status: 201, body: { id: ID, status: 'active' } });
    expect((await call('POST', '/api/invoices', { body: '{}' })).status).toBe(201);
    stub.answer({ status: 200, body: { id: ID, status: 'active' } });
    expect((await call('POST', '/api/invoices', { body: '{}' })).status).toBe(200);
  });

  it('passes X-Request-Id, X-Client-Request-Id and X-Api-Key-Deprecated through', async () => {
    stub.answer({
      status: 200,
      body: { apiKey: { status: 'previous' } },
      headers: { 'X-Request-Id': 'r-1', 'X-Api-Key-Deprecated': '2026-11-17T13:00:00Z', 'X-Other': 'no' },
    });
    const res = await call('GET', '/api/account');
    expect(res.headers.get('x-request-id')).toBe('r-1');
    expect(res.headers.get('x-api-key-deprecated')).toBe('2026-11-17T13:00:00Z');
    expect(res.headers.get('x-other')).toBeNull();
    const [entry] = await logOf(res.headers.get('x-example-call-id') ?? '');
    expect(entry).toMatchObject({ requestId: 'r-1', apiKeyDeprecatedUntil: '2026-11-17T13:00:00Z' });
  });

  it('passes a platform error through unchanged', async () => {
    const error = { errorCode: 'invoice_conflict', errorMessage: 'taken', details: { invoiceId: ID } };
    stub.answer({ status: 409, body: error, headers: { 'X-Request-Id': 'r-409' } });
    const res = await call('POST', '/api/invoices', { body: '{}' });
    expect(res.status).toBe(409);
    expect(res.json).toEqual(error);
    expect(res.headers.get('x-request-id')).toBe('r-409');
    expect(res.headers.get('x-example-call-id')).toMatch(/^[0-9a-f-]{36}$/);
    const [entry] = await logOf(res.headers.get('x-example-call-id') ?? '');
    expect(entry).toMatchObject({ status: 409, errorCode: 'invoice_conflict', requestId: 'r-409' });
  });

  it('passes 401 api_auth_failed through, without WWW-Authenticate, and logs the string the SDK signed', async () => {
    const error = {
      errorCode: 'api_auth_failed',
      errorMessage: 'bad signature',
      details: { reason: 'bad_signature', stringToSign: 'v1\nGET\n/api/v1/account\n1\nn\nx' },
    };
    stub.answer({ status: 401, body: error });
    const res = await call('GET', '/api/account');
    expect(res.status).toBe(401);
    expect(res.json).toEqual(error);
    expect(res.headers.get('www-authenticate')).toBeNull();

    const [item] = await logOf(res.headers.get('x-example-call-id') ?? '');
    const entry = (await call('GET', `/api/request-log/${item?.id ?? ''}`)).json as {
      signing: { stringToSign: string; bodySha256: string };
      requestHeaders: Record<string, string>;
    };
    const sent = stub.requests[0]?.headers ?? {};
    expect(entry.signing.stringToSign).toBe(
      `v1\nGET\n/api/v1/account\n${String(sent['x-api-timestamp'])}\n${String(sent['x-api-nonce'])}\n${entry.signing.bodySha256}`,
    );
    expect(entry.signing.bodySha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('passes 503 maintenance with Retry-After through after the retries of the SDK', async () => {
    const error = { errorCode: 'maintenance', errorMessage: 'later', details: { message: 'm' } };
    stub.answer({ status: 503, body: error, headers: { 'Retry-After': '0' } });
    const res = await call('GET', '/api/balances');
    expect(res.status).toBe(503);
    expect(res.json).toEqual(error);
    expect(res.headers.get('retry-after')).toBe('0');
    // The SDK's default policy: the first attempt and 4 retries
    expect(stub.requests).toHaveLength(5);
    const log = await logOf(res.headers.get('x-example-call-id') ?? '');
    expect(log.map((e) => e.attempt).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('retries: one call, several attempts', () => {
  it('logs each attempt with the same callId and answers with the outcome of the last', async () => {
    stub.answer(
      {
        status: 429,
        body: { errorCode: 'too_many_requests', errorMessage: 'slow down', details: null },
        headers: { 'Retry-After': '0' },
      },
      { status: 503, body: { errorCode: 'service_unavailable', errorMessage: 'busy', details: null } },
      { status: 201, body: { id: ID } },
    );
    const res = await call('POST', '/api/invoices', { body: '{"externalId":"order-7"}' });
    expect(res.status).toBe(201);
    expect(stub.requests).toHaveLength(3);
    // Every attempt is signed anew, the body bytes stay the same
    expect(new Set(stub.requests.map((r) => r.headers['x-api-nonce'])).size).toBe(3);
    expect(new Set(stub.requests.map((r) => r.body))).toEqual(new Set(['{"externalId":"order-7"}']));

    const log = await logOf(res.headers.get('x-example-call-id') ?? '');
    expect(log.map((e) => [e.attempt, e.status, e.errorCode])).toEqual([
      [3, 201, null],
      [2, 503, 'service_unavailable'],
      [1, 429, 'too_many_requests'],
    ]);
  });
});

describe('the SDK’s own errors become example_* codes', () => {
  it('an answer that is not the platform’s: 502 example_upstream_bad_response', async () => {
    stub.answer({ status: 500, body: '<html>proxy error</html>', headers: { 'Content-Type': 'text/html' } });
    const res = await call('GET', '/api/networks');
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({
      errorCode: 'example_upstream_bad_response',
      details: { status: 500, requestId: 'req-1', bodyPreview: '<html>proxy error</html>' },
    });
    expect(res.headers.get('x-example-call-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an empty 2xx body: 502 example_upstream_bad_response', async () => {
    stub.answer({ status: 200, body: '' });
    expect((await call('GET', '/api/tariff')).json).toMatchObject({ errorCode: 'example_upstream_bad_response' });
  });

  it('no connection: 502 example_upstream_unreachable, each attempt logged with a transport error', async () => {
    const closed = await new PlatformStub().start();
    await closed.stop();
    const offline = await startApp(testEnv(closed.url));
    try {
      const res = await fetch(`${offline.url}/api/account`);
      const body = (await res.json()) as { errorCode: string; details: { cause: string } };
      expect(res.status).toBe(502);
      expect(body.errorCode).toBe('example_upstream_unreachable');
      expect(body.details.cause).toContain('ECONNREFUSED');
      const log = (await (await fetch(`${offline.url}/api/request-log?status=error`)).json()) as { items: LogItem[] };
      expect(log.items).toHaveLength(5);
      expect(log.items.every((e) => e.status === null && e.transportError?.code === 'network')).toBe(true);
    } finally {
      await offline.close();
    }
  });
});

describe('the CSV statement', () => {
  it('is the platform’s text byte for byte, with its headers', async () => {
    const csv = 'network,asset,opening,closing\r\ntron,USDT,"1,5",2.00\r\n';
    stub.answer({
      status: 200,
      body: csv,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Request-Id': 'r-csv',
        'X-Client-Request-Id': 'ui-csv',
        'X-Api-Key-Deprecated': '2026-11-17T13:00:00Z',
      },
    });
    const res = await call('GET', '/api/operations/statement?from=2026-11-01&to=2026-11-02&format=csv', {
      headers: { 'X-Client-Request-Id': 'ui-csv' },
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe(csv);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('x-request-id')).toBe('r-csv');
    expect(res.headers.get('x-client-request-id')).toBe('ui-csv');
    expect(res.headers.get('x-api-key-deprecated')).toBe('2026-11-17T13:00:00Z');
    expect(stub.requests[0]?.headers.accept).toBe('text/csv, application/json');
    expect(stub.requests[0]?.target).toContain('format=csv');
  });

  it('JSON without format=csv', async () => {
    stub.answer({ status: 200, body: { items: [] } });
    const res = await call('GET', '/api/operations/statement?from=2026-11-01&to=2026-11-02');
    expect(res.json).toEqual({ items: [] });
  });
});

describe('request log', () => {
  it('keeps headers and bodies, the signature headers included, never the secret', async () => {
    stub.answer({ status: 201, body: { id: ID } });
    const res = await call('POST', '/api/invoices', { body: '{"externalId":"order-9"}' });
    const [item] = await logOf(res.headers.get('x-example-call-id') ?? '');
    const entryRes = await call('GET', `/api/request-log/${item?.id ?? ''}`);
    const entry = entryRes.json as Record<string, unknown> & {
      requestHeaders: Record<string, string>;
      responseHeaders: Record<string, string>;
    };
    expect(entry).toMatchObject({
      url: `${stub.url}/api/v1/invoices`,
      path: '/api/v1/invoices',
      requestBody: '{"externalId":"order-9"}',
      responseBody: JSON.stringify({ id: ID }),
      responseBodyTruncated: false,
      signing: null,
    });
    expect(entry.requestHeaders['X-Api-Key']).toBe(API_KEY);
    expect(entry.requestHeaders['X-Api-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(entry.responseHeaders['x-request-id']).toBe('req-1');
    expect(entryRes.text).not.toContain(API_SECRET);
    expect((await call('GET', '/api/config')).text).not.toContain(API_SECRET);
  });

  it('filters, pages and clears', async () => {
    stub.answer({ status: 200, body: {} });
    await call('GET', '/api/account');
    await call('GET', '/api/tariff');
    stub.answer({ status: 404, body: { errorCode: 'not_found', errorMessage: 'no', details: null } });
    await call('GET', `/api/payouts/${ID}`);

    const page = (q: string): Promise<{ items: LogItem[]; total: number; page: number; limit: number }> =>
      call('GET', `/api/request-log${q}`).then((r) => r.json as never);
    expect((await page('')).total).toBe(3);
    expect((await page('?operationId=getMerchantTariff')).items.map((e) => e.operationId)).toEqual([
      'getMerchantTariff',
    ]);
    expect((await page('?status=4xx')).items.map((e) => e.operationId)).toEqual(['getPayout']);
    const second = await page('?limit=2&page=2');
    expect(second).toMatchObject({ page: 2, limit: 2, total: 3 });
    // Newest first: the oldest entry is on the second page
    expect(second.items.map((e) => e.operationId)).toEqual(['getAccount']);

    for (const bad of ['?status=6xx', '?limit=0', '?limit=201', '?page=x', '?callId=nope', '?source=console']) {
      expect((await call('GET', `/api/request-log${bad}`)).json).toMatchObject({
        errorCode: 'example_invalid_request',
      });
    }
    expect((await call('GET', `/api/request-log/${ID}`)).json).toMatchObject({ errorCode: 'example_not_found' });
    expect((await call('DELETE', '/api/request-log')).status).toBe(204);
    expect((await page('')).total).toBe(0);
  });

  it('keeps at most APP_LOG_LIMIT entries', async () => {
    const small = await startApp(testEnv(stub.url, { APP_LOG_LIMIT: '2' }));
    try {
      stub.answer({ status: 200, body: {} });
      for (let i = 0; i < 3; i++) await fetch(`${small.url}/api/account`);
      const log = (await (await fetch(`${small.url}/api/request-log`)).json()) as { total: number };
      expect(log.total).toBe(2);
    } finally {
      await small.close();
    }
  });
});

describe('example routes', () => {
  it('GET /api/config', async () => {
    const res = await call('GET', '/api/config');
    expect(res.json).toMatchObject({
      backend: 'sdk',
      version: '0.1.0',
      sdkVersion: expect.any(String),
      net: 'testnet',
      apiUrl: stub.url,
      keyId: API_KEY,
      previousSecretSet: false,
      checkoutUrl: 'https://pay.psp.qubiq.cc',
      webhookUrl: 'https://sdk-example.test/webhooks/psp',
      serverTime: expect.any(String),
    });
    expect(res.headers.get('x-example-call-id')).toBeNull();
  });

  it('an unknown route is 404 example_not_found', async () => {
    const res = await call('GET', '/api/nothing');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ errorCode: 'example_not_found', errorMessage: 'No such route', details: null });
  });
});
