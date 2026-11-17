// The conformance suite: the single definition of "this backend implements the examples contract".
// A backend's vitest file calls defineConformanceSuite({ name, start }); see README, "Conformance suite".
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_KEY,
  LIVE_SECRET,
  TEST_KEY,
  TEST_PREVIOUS_SECRET,
  TEST_SECRET,
  fakeUuid,
  startFakeGateway,
  webhookBody,
  type FakeGateway,
  type RecordedRequest,
  type SentWebhook,
} from '../fake-gateway/index.js';
import {
  MERCHANT_OPERATION_IDS,
  merchantExample,
  validateAt,
  validateResponse,
  validateSchema,
} from '../internal/contract.js';
import { verifyCheckoutToken } from '../internal/crypto.js';
import { FORWARD_CASES, IDS, type ForwardCase } from './cases.js';
import { openSse, request, type Answer, type CallInit } from './http.js';

export { FORWARD_CASES } from './cases.js';
export { openSse, request } from './http.js';
export type { Answer, CallInit, SseEvent, SseStream } from './http.js';

/** The environment a backend gets from the suite. Pass it to the backend as its process environment. */
export interface ConformanceEnv extends Record<string, string> {
  PSP_API_URL: string;
  PSP_API_KEY: string;
  PSP_API_SECRET: string;
  PSP_API_PREVIOUS_SECRET: string;
  PSP_CHECKOUT_URL: string;
  APP_PUBLIC_URL: string;
  APP_TESTNET_ONLY: string;
  APP_UPSTREAM_TIMEOUT_MS: string;
}

export interface StartedBackend {
  /** Where the backend listens, e.g. `http://127.0.0.1:41235`. */
  baseUrl: string;
  stop(): Promise<void>;
}

export type StartBackend = (env: ConformanceEnv) => Promise<StartedBackend>;

export interface ConformanceOptions {
  /** Which backend this is: `/api/config` must say the same, and the per-backend rules depend on it. */
  name: 'plain' | 'sdk';
  start: StartBackend;
  /** Timeout of one test, ms. Default 20 000. */
  testTimeoutMs?: number;
}

/** The receiver reads at most this much of a body (the platform's largest webhook); a larger one is `413`. */
export const WEBHOOK_BODY_LIMIT = 64 * 1024;
/** Requests without a valid signature: how many are kept, and how much of their body. */
export const UNVERIFIED_LIMIT = 100;
export const UNVERIFIED_BODY_BYTES = 512;

export const CHECKOUT_URL = 'https://pay.conformance.example';
export const PUBLIC_URL = 'https://backend.conformance.example';
/** The per-attempt platform timeout the suite gives a backend; the timeout test makes the platform slower. */
export const UPSTREAM_TIMEOUT_MS = 1500;

/** The environment for a backend against a fake gateway at `gatewayUrl`. */
export function conformanceEnv(gatewayUrl: string, overrides: Partial<ConformanceEnv> = {}): ConformanceEnv {
  return {
    PSP_API_URL: gatewayUrl,
    PSP_API_KEY: TEST_KEY,
    PSP_API_SECRET: TEST_SECRET,
    PSP_API_PREVIOUS_SECRET: TEST_PREVIOUS_SECRET,
    PSP_CHECKOUT_URL: CHECKOUT_URL,
    APP_PUBLIC_URL: PUBLIC_URL,
    APP_TESTNET_ONLY: 'true',
    APP_UPSTREAM_TIMEOUT_MS: String(UPSTREAM_TIMEOUT_MS),
    ...overrides,
  };
}

/**
 * The testnet guard is a start-time behaviour: with `APP_TESTNET_ONLY=true` and a `psp_pk_live_…` key the backend
 * must refuse to start (`start` rejects). Resolves when it does; throws when the backend started.
 */
export async function expectStartRefusesLiveKey(start: StartBackend): Promise<void> {
  const env = conformanceEnv('https://api.conformance.example', {
    PSP_API_KEY: LIVE_KEY,
    PSP_API_SECRET: LIVE_SECRET,
    PSP_API_PREVIOUS_SECRET: '',
  });
  let started: StartedBackend | undefined;
  try {
    started = await start(env);
  } catch {
    return;
  }
  await started.stop();
  throw new Error('the backend started with APP_TESTNET_ONLY=true and a psp_pk_live_ key');
}

// ------------------------------------------------------------------------------------------------ helpers

interface Route {
  operationId: string;
  method: string;
  path: string;
  merchantApi: string | null;
  sdkMethod: string | null;
  extra: boolean;
}
const routes = JSON.parse(readFileSync(new URL('../routes.json', import.meta.url), 'utf8')) as Route[];
const sdkMethodOf = (operationId: string): string | null =>
  routes.find((r) => r.merchantApi === operationId)?.sdkMethod ?? null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSED_HEADERS = ['x-request-id', 'x-client-request-id', 'x-api-key-deprecated', 'retry-after'];
const SECRET_TAIL = TEST_SECRET.slice('psp_sk_test_'.length);
const PREVIOUS_TAIL = TEST_PREVIOUS_SECRET.slice('psp_sk_test_'.length);

/** No secret and no 6-character piece of its random part in the text. */
function expectNoSecret(text: string, where: string): void {
  for (const tail of [SECRET_TAIL, PREVIOUS_TAIL]) {
    for (let i = 0; i + 6 <= tail.length; i++) {
      const piece = tail.slice(i, i + 6);
      expect(text.includes(piece), `${where} contains "${piece}", a piece of the secret`).toBe(false);
    }
  }
}

const expectValid = (errors: string[], where: string): void => {
  expect(errors, `${where} does not match the contract`).toEqual([]);
};

const sortedPairs = (pairs: Iterable<[string, string]>): string[] => [...pairs].map(([k, v]) => `${k}=${v}`).sort();

interface LogItem {
  id: string;
  callId: string;
  source: string;
  operationId: string;
  sdkMethod: string | null;
  attempt: number;
  method: string;
  path: string;
  status: number | null;
  errorCode: string | null;
  requestId: string | null;
  clientRequestId: string | null;
  apiKeyDeprecatedUntil: string | null;
  transportError: { code: string; message: string } | null;
}

interface LogEntry extends LogItem {
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestBodyTruncated: boolean;
  responseBody: string | null;
  responseBodyTruncated: boolean;
  signing: { stringToSign: string; bodySha256: string | null } | null;
}

const lower = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

// ------------------------------------------------------------------------------------------------ the suite

/** Defines the conformance tests of one backend (a `describe` block). Call it at the top of a vitest file. */
export function defineConformanceSuite(options: ConformanceOptions): void {
  const { name } = options;
  const timeout = options.testTimeoutMs ?? 20_000;
  let gateway: FakeGateway;
  let backend: StartedBackend;
  let base = '';

  const call = (path: string, init?: CallInit): Promise<Answer> => request(base, path, init);

  /** A passthrough call: the answer, and the platform requests it caused. */
  async function passthrough(
    operationId: string,
    path: string,
    init: CallInit = {},
  ): Promise<{ res: Answer; sent: RecordedRequest[] }> {
    const mark = gateway.requests.length;
    const res = await call(path, init);
    return { res, sent: gateway.since(mark) };
  }

  async function logOf(callId: string): Promise<LogItem[]> {
    const res = await call(`/api/request-log?callId=${callId}&limit=200`);
    expect(res.status).toBe(200);
    expectValid(validateResponse('listRequestLog', res.status, res.contentType, res.json), 'GET /api/request-log');
    return [...(res.json as { items: LogItem[] }).items].sort((a, b) => a.attempt - b.attempt);
  }

  /**
   * The rules every passthrough answer follows: signed platform requests of the operation, the last platform answer
   * passed through (status, body, headers), X-Example-Call-Id, the contract schema, and one log entry per attempt.
   */
  async function expectPassthrough(
    operationId: string,
    res: Answer,
    sent: RecordedRequest[],
    expected: { source?: 'ui' | 'poll'; clientRequestId?: string } = {},
  ): Promise<{ last: RecordedRequest; log: LogItem[] }> {
    expect(sent.length, `${operationId}: platform requests`).toBeGreaterThanOrEqual(1);
    if (name === 'plain') expect(sent.length, 'plain makes one attempt per call').toBe(1);
    for (const r of sent) {
      expect(r.operationId).toBe(operationId);
      expect(r.auth, `${operationId}: the signature of the platform request`).toMatchObject({ ok: true });
      expect(r.headers['x-example-source'], 'X-Example-Source is not forwarded').toBeUndefined();
      expect(r.headers['x-example-call-id'], 'X-Example-Call-Id is not forwarded').toBeUndefined();
    }
    const last = sent[sent.length - 1] as RecordedRequest;
    const answer = last.response;
    expect(answer, `${operationId}: the platform answered`).not.toBeNull();
    if (!answer) throw new Error('no answer');

    // status, body, headers unchanged
    expect(res.status, `${operationId}: status`).toBe(answer.status);
    if (answer.headers['content-type']?.startsWith('text/csv')) {
      expect(res.contentType).toMatch(/^text\/csv/);
      expect(res.text, 'the CSV statement byte for byte').toBe(answer.body);
    } else {
      expect(res.json, `${operationId}: body`).toEqual(JSON.parse(answer.body));
    }
    for (const header of PASSED_HEADERS) {
      expect(res.headers.get(header), `${operationId}: header ${header}`).toBe(answer.headers[header] ?? null);
    }
    expect(res.callId, 'X-Example-Call-Id').toMatch(UUID_RE);
    expectValid(
      validateResponse(operationId, res.status, res.contentType, res.json ?? res.text),
      `${operationId} ${res.status}`,
    );

    // the request log of the call
    const log = await logOf(res.callId ?? '');
    expect(log.length, `${operationId}: one log entry per attempt`).toBe(sent.length);
    log.forEach((item, i) => {
      const attempt = sent[i] as RecordedRequest;
      expect(item).toMatchObject({
        callId: res.callId,
        source: expected.source ?? 'ui',
        operationId,
        sdkMethod: name === 'sdk' ? sdkMethodOf(operationId) : null,
        attempt: i + 1,
        method: attempt.method,
        path: attempt.target,
        status: attempt.response?.status ?? null,
        requestId: attempt.response?.headers['x-request-id'] ?? null,
        clientRequestId: expected.clientRequestId ?? null,
        apiKeyDeprecatedUntil: attempt.response?.headers['x-api-key-deprecated'] ?? null,
        transportError: null,
      });
      const json =
        attempt.response && !attempt.response.headers['content-type']?.startsWith('text/csv')
          ? JSON.parse(attempt.response.body)
          : null;
      expect(item.errorCode).toBe(
        attempt.response && attempt.response.status >= 400 ? (json?.errorCode ?? null) : null,
      );
    });

    // the full entry of the last attempt
    const lastItem = log[log.length - 1] as LogItem;
    const entryRes = await call(`/api/request-log/${lastItem.id}`);
    expect(entryRes.status).toBe(200);
    expectValid(validateResponse('getRequestLogEntry', 200, entryRes.contentType, entryRes.json), 'request-log entry');
    expect(entryRes.text.includes(TEST_SECRET), 'the log entry contains the secret').toBe(false);
    const entry = entryRes.json as LogEntry;
    const headers = lower(entry.requestHeaders);
    for (const h of ['x-api-key', 'x-api-timestamp', 'x-api-nonce', 'x-api-signature']) {
      expect(headers[h], `log entry request header ${h}`).toBe(last.headers[h]);
    }
    expect(entry.requestBody ?? '').toBe(last.body);
    expect(entry.requestBodyTruncated).toBe(false);
    if (!entry.responseBodyTruncated) expect(entry.responseBody).toBe(answer.body);
    if (name === 'plain') {
      expect(entry.signing?.stringToSign, 'plain: the string it signed').toBe(last.auth.stringToSign);
    } else if (!(answer.status === 401 && JSON.parse(answer.body).errorCode === 'api_auth_failed')) {
      expect(entry.signing).toBeNull();
    }
    return { last, log };
  }

  /** `field` — for `example_invalid_request`, the expected `details.field` (see the contract's `ExampleErrorCode`). */
  async function expectExampleError(res: Answer, status: number, errorCode: string, field?: string): Promise<void> {
    expect(res.status, `${errorCode}: status`).toBe(status);
    expect(res.json).toMatchObject({ errorCode });
    if (field !== undefined) {
      expect((res.json as { details?: { field?: unknown } }).details?.field, `${errorCode}: details.field`).toBe(field);
    }
    expectValid(validateSchema('ExampleError', res.json), errorCode);
    expectNoSecret(res.text, errorCode);
  }

  describe(`examples contract — ${name} backend`, { timeout }, () => {
    beforeAll(async () => {
      gateway = await startFakeGateway();
      backend = await options.start(conformanceEnv(gateway.url));
      base = backend.baseUrl;
    }, 60_000);

    afterAll(async () => {
      await backend?.stop();
      await gateway?.close();
    });

    it('starts without platform calls of its own, with an empty request log', async () => {
      expect(gateway.requests, 'platform calls made without a contract request').toEqual([]);
      const cleared = await call('/api/request-log', { method: 'DELETE' });
      expect(cleared.status).toBe(204);
      const list = await call('/api/request-log');
      expect(list.json).toMatchObject({ items: [], total: 0 });
    });

    // ---------------------------------------------------------------------------------------- config

    describe('GET /api/config', () => {
      it('describes this deployment and contains no part of the secret', async () => {
        const res = await call('/api/config');
        expect(res.status).toBe(200);
        expectValid(validateResponse('getConfig', 200, res.contentType, res.json), 'config');
        expect(res.json).toMatchObject({
          backend: name,
          net: 'testnet',
          apiUrl: expect.stringContaining(new URL(gateway.url).host),
          keyId: TEST_KEY,
          previousSecretSet: true,
          checkoutUrl: CHECKOUT_URL,
          webhookUrl: `${PUBLIC_URL}/webhooks/psp`,
        });
        if (name === 'plain') expect((res.json as { sdkVersion: unknown }).sdkVersion).toBeNull();
        else expect((res.json as { sdkVersion: unknown }).sdkVersion).toEqual(expect.any(String));
        expectNoSecret(res.text, '/api/config');
        expect(gateway.requests).toEqual([]);
      });
    });

    // ---------------------------------------------------------------------------------------- passthrough

    describe('passthrough of the 27 Merchant API operations', () => {
      it.each(FORWARD_CASES.map((c) => [c.operationId, c] as [string, ForwardCase]))('%s', async (operationId, c) => {
        const { res, sent } = await passthrough(operationId, c.path, { method: c.method, body: c.body });
        const { last } = await expectPassthrough(operationId, res, sent);
        // forwarded as the contract says: method, path, every query parameter, the body
        expect(last.method).toBe(c.method);
        expect(last.path).toBe(c.merchantPath);
        const query = new URL(c.path, 'http://x').searchParams;
        expect(sortedPairs(last.query)).toEqual(sortedPairs(query.entries()));
        if (c.body === undefined) expect(last.body).toBe('');
        else expect(JSON.parse(last.body)).toEqual(c.body);
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
      });

      it('getMerchantOperationsStatement with format=csv: the CSV byte for byte', async () => {
        const path = '/api/operations/statement?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z&format=csv';
        const { res, sent } = await passthrough('getMerchantOperationsStatement', path);
        await expectPassthrough('getMerchantOperationsStatement', res, sent);
        expect(res.contentType).toMatch(/^text\/csv/);
        expect(sent.at(-1)?.query).toContainEqual(['format', 'csv']);
      });

      it('createInvoice: 201 new, 200 an idempotent repeat, 409 invoice_conflict with details', async () => {
        const body = { externalId: 'conformance-order-2', network: 'tron', asset: 'USDT', amount: '12.5' };
        const first = await passthrough('createInvoice', '/api/invoices', { method: 'POST', body });
        await expectPassthrough('createInvoice', first.res, first.sent);
        expect(first.res.status).toBe(201);
        const repeat = await passthrough('createInvoice', '/api/invoices', { method: 'POST', body });
        await expectPassthrough('createInvoice', repeat.res, repeat.sent);
        expect(repeat.res.status).toBe(200);
        expect(repeat.res.json).toEqual(first.res.json);
        const conflict = await passthrough('createInvoice', '/api/invoices', {
          method: 'POST',
          body: { ...body, amount: '13' },
        });
        await expectPassthrough('createInvoice', conflict.res, conflict.sent);
        expect(conflict.res.status).toBe(409);
        expect(conflict.res.json).toMatchObject({
          errorCode: 'invoice_conflict',
          details: { invoiceId: (first.res.json as { id: string }).id },
        });
      });

      it('createPayout: 201 new, 200 an idempotent repeat', async () => {
        const body = {
          externalId: 'conformance-payout-2',
          network: 'tron',
          asset: 'USDT',
          toAddress: 'TRPVdtxhhSuP22mNW77LwGicsZDTrqpCrT',
          amount: '7',
        };
        const first = await passthrough('createPayout', '/api/payouts', { method: 'POST', body });
        await expectPassthrough('createPayout', first.res, first.sent);
        expect(first.res.status).toBe(201);
        const repeat = await passthrough('createPayout', '/api/payouts', { method: 'POST', body });
        await expectPassthrough('createPayout', repeat.res, repeat.sent);
        expect(repeat.res.status).toBe(200);
      });

      it('cancelInvoice without a body sends no body', async () => {
        const { res, sent } = await passthrough('cancelInvoice', `/api/invoices/${IDS.invoice}/cancel`, {
          method: 'POST',
        });
        await expectPassthrough('cancelInvoice', res, sent);
        expect(sent.at(-1)?.body).toBe('');
      });

      it('setWebhookUrl: 202 passes through', async () => {
        gateway.inject('setWebhookUrl', { status: 202, json: merchantExample('setWebhookUrl', 202) });
        const { res, sent } = await passthrough('setWebhookUrl', '/api/webhook', {
          method: 'PUT',
          body: { url: 'https://shop.example.com/psp/webhooks' },
        });
        await expectPassthrough('setWebhookUrl', res, sent);
        expect(res.status).toBe(202);
      });

      it('X-Client-Request-Id is forwarded, echoed and logged', async () => {
        const { res, sent } = await passthrough('getAccount', '/api/account', {
          headers: { 'X-Client-Request-Id': 'conformance-req-1' },
        });
        await expectPassthrough('getAccount', res, sent, { clientRequestId: 'conformance-req-1' });
        expect(sent.every((r) => r.headers['x-client-request-id'] === 'conformance-req-1')).toBe(true);
        expect(res.headers.get('x-client-request-id')).toBe('conformance-req-1');
      });

      it('X-Api-Key-Deprecated passes through and is logged', async () => {
        gateway.inject('getAccount', {
          status: 200,
          json: merchantExample('getAccount', 200),
          headers: { 'X-Api-Key-Deprecated': '2026-09-29T13:00:00.000Z' },
        });
        const { res, sent } = await passthrough('getAccount', '/api/account');
        await expectPassthrough('getAccount', res, sent);
        expect(res.headers.get('x-api-key-deprecated')).toBe('2026-09-29T13:00:00.000Z');
      });

      it('X-Example-Source: poll is not forwarded and marks the log entries', async () => {
        const { res, sent } = await passthrough('getInvoice', `/api/invoices/${IDS.invoice}`, {
          headers: { 'X-Example-Source': 'poll' },
        });
        await expectPassthrough('getInvoice', res, sent, { source: 'poll' });
        const ui = await call(`/api/request-log?source=ui&limit=200`);
        expect((ui.json as { items: LogItem[] }).items.some((i) => i.callId === res.callId)).toBe(false);
        const poll = await call(`/api/request-log?source=poll&limit=200`);
        expect((poll.json as { items: LogItem[] }).items.some((i) => i.callId === res.callId)).toBe(true);
      });

      it('an unknown query parameter is forwarded; the platform 400 invalid_schema passes through', async () => {
        const { res, sent } = await passthrough('listInvoices', '/api/invoices?limit=5&color=green');
        await expectPassthrough('listInvoices', res, sent);
        expect(sent.at(-1)?.query).toContainEqual(['color', 'green']);
        expect(res.status).toBe(400);
        expect(res.json).toMatchObject({ errorCode: 'invalid_schema', details: { fields: [{ field: 'color' }] } });
      });

      it('an unknown body field is forwarded; the platform 400 invalid_schema passes through', async () => {
        const body = { externalId: 'conformance-order-3', network: 'tron', asset: 'USDT', amount: '1', color: 'green' };
        const { res, sent } = await passthrough('createInvoice', '/api/invoices', { method: 'POST', body });
        await expectPassthrough('createInvoice', res, sent);
        expect(JSON.parse(sent.at(-1)?.body ?? '{}')).toEqual(body);
        expect(res.status).toBe(400);
      });
    });

    // ---------------------------------------------------------------------------------------- platform errors

    describe('platform errors pass through unchanged', () => {
      it('404 not_found', async () => {
        gateway.injectError('getInvoice', 'not_found', {
          status: 404,
          details: { object: 'invoice', id: IDS.invoice },
        });
        const { res, sent } = await passthrough('getInvoice', `/api/invoices/${IDS.invoice}`);
        await expectPassthrough('getInvoice', res, sent);
        expect(res.status).toBe(404);
      });

      it('401 api_auth_failed with details.stringToSign', async () => {
        gateway.inject('getAccount', (req) => ({
          status: 401,
          json: {
            errorCode: 'api_auth_failed',
            errorMessage: 'Request signature does not match',
            details: { reason: 'bad_signature', stringToSign: req.auth.stringToSign },
          },
        }));
        const { res, sent } = await passthrough('getAccount', '/api/account');
        await expectPassthrough('getAccount', res, sent);
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate'), 'a 401 must not ask the browser for basic auth').toBeNull();
      });

      it('429 too_many_requests with Retry-After', async () => {
        gateway.injectError('sendTestWebhook', 'too_many_requests', {
          status: 429,
          details: { scope: 'webhook_test', retryAfterSeconds: 7 },
          headers: { 'Retry-After': '7' },
        });
        const { res, sent } = await passthrough('sendTestWebhook', '/api/webhook/test', { method: 'POST', body: {} });
        await expectPassthrough('sendTestWebhook', res, sent);
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('7');
      });

      it('503 maintenance with Retry-After', async () => {
        gateway.injectError('sendTestWebhook', 'maintenance', {
          status: 503,
          details: { message: 'Planned works' },
          headers: { 'Retry-After': '300' },
        });
        const { res, sent } = await passthrough('sendTestWebhook', '/api/webhook/test', { method: 'POST', body: {} });
        await expectPassthrough('sendTestWebhook', res, sent);
        expect(res.status).toBe(503);
      });

      it('409 payout_conflict with details', async () => {
        gateway.injectError('createPayout', 'payout_conflict', { status: 409, details: { payoutId: IDS.payout } });
        const body = {
          externalId: 'conformance-payout-3',
          network: 'tron',
          asset: 'USDT',
          toAddress: 'TRPVdtxhhSuP22mNW77LwGicsZDTrqpCrT',
          amount: '7',
        };
        const { res, sent } = await passthrough('createPayout', '/api/payouts', { method: 'POST', body });
        await expectPassthrough('createPayout', res, sent);
        expect(res.json).toMatchObject({ errorCode: 'payout_conflict', details: { payoutId: IDS.payout } });
      });

      it('a retried call: every attempt logged under one callId, the last answer passed through', async () => {
        // sdk retries 429 after Retry-After (0 s here); plain makes one attempt. Both end with the platform's 429.
        gateway.injectError('listNetworks', 'too_many_requests', {
          status: 429,
          details: { scope: 'api', retryAfterSeconds: 0 },
          headers: { 'Retry-After': '0' },
          times: 'always',
        });
        try {
          const { res, sent } = await passthrough('listNetworks', '/api/networks');
          const { log } = await expectPassthrough('listNetworks', res, sent);
          expect(res.status).toBe(429);
          expect(new Set(log.map((l) => l.callId)).size).toBe(1);
        } finally {
          gateway.clearInjections();
        }
      });
    });

    // ---------------------------------------------------------------------------------------- own errors

    describe('backend-own errors', () => {
      it('a body that is not JSON: 400 example_invalid_request, no platform call', async () => {
        const mark = gateway.requests.length;
        const res = await call('/api/invoices', { method: 'POST', raw: '{"externalId": ' });
        await expectExampleError(res, 400, 'example_invalid_request', 'body');
        expect(res.callId, 'X-Example-Call-Id on every passthrough answer').toMatch(UUID_RE);
        expect(gateway.since(mark)).toEqual([]);
      });

      it('a body that is not Content-Type: application/json: 400 example_invalid_request, no platform call', async () => {
        // What a cross-site <form enctype="text/plain"> can send: valid JSON, but not as application/json
        const mark = gateway.requests.length;
        const json = JSON.stringify({ externalId: 'csrf-1', network: 'tron', asset: 'USDT', amount: '1' });
        for (const contentType of [
          'text/plain',
          'application/x-www-form-urlencoded',
          'multipart/form-data; boundary=x',
        ]) {
          const res = await call('/api/invoices', {
            method: 'POST',
            raw: json,
            headers: { 'content-type': contentType },
          });
          await expectExampleError(res, 400, 'example_invalid_request', 'Content-Type');
          expect(res.callId, 'X-Example-Call-Id on every passthrough answer').toMatch(UUID_RE);
        }
        const receiver = await call('/api/receiver', {
          method: 'PUT',
          raw: JSON.stringify({ mode: 'fixed', status: 500, delayMs: 0, failNext: 0 }),
          headers: { 'content-type': 'text/plain' },
        });
        await expectExampleError(receiver, 400, 'example_invalid_request', 'Content-Type');
        expect((await call('/api/receiver')).json).toMatchObject({ mode: 'auto' });
        expect(gateway.since(mark)).toEqual([]);
      });

      it('a state-changing request from another site: 403 example_forbidden, no platform call', async () => {
        const mark = gateway.requests.length;
        const body = { externalId: 'csrf-2', network: 'tron', asset: 'USDT', amount: '1' };
        const crossSite: Record<string, string>[] = [
          { Origin: 'https://attacker.example' },
          { Origin: 'null' },
          { 'Sec-Fetch-Site': 'cross-site' },
          { 'Sec-Fetch-Site': 'same-site' },
          { Origin: new URL(base).origin, 'Sec-Fetch-Site': 'cross-site' },
        ];
        for (const headers of crossSite) {
          const res = await call('/api/invoices', { method: 'POST', body, headers });
          await expectExampleError(res, 403, 'example_forbidden');
          const header = 'Sec-Fetch-Site' in headers ? 'Sec-Fetch-Site' : 'Origin';
          expect(res.json, JSON.stringify(headers)).toMatchObject({ details: { header } });
          expect(res.callId, 'X-Example-Call-Id on every passthrough answer').toMatch(UUID_RE);
        }
        const settings = { mode: 'fixed', status: 500, delayMs: 0, failNext: 0 };
        for (const [method, path, init] of [
          ['PUT', '/api/receiver', { body: settings }],
          ['DELETE', '/api/request-log', {}],
          ['DELETE', '/api/received-webhooks', {}],
          ['POST', `/api/invoices/${IDS.invoice}/checkout-link`, { body: {} }],
        ] as const) {
          const res = await call(path, { method, ...init, headers: { Origin: 'https://attacker.example' } });
          await expectExampleError(res, 403, 'example_forbidden');
        }
        expect((await call('/api/receiver')).json).toMatchObject({ mode: 'auto' });
        expect(gateway.since(mark)).toEqual([]);
        // Reading is not state-changing: a GET with a foreign Origin is answered (the browser keeps it from the page)
        expect((await call('/api/config', { headers: { Origin: 'https://attacker.example' } })).status).toBe(200);
      });

      it('same-origin browser requests and requests without Origin (curl) pass', async () => {
        const sameOrigin = await passthrough('getMerchantTariff', '/api/tariff');
        expect(sameOrigin.res.status).toBe(200);
        const allowed: Record<string, string>[] = [
          { Origin: new URL(base).origin, 'Sec-Fetch-Site': 'same-origin' },
          { 'Sec-Fetch-Site': 'none' },
          {},
        ];
        for (const headers of allowed) {
          const { res, sent } = await passthrough('sendTestWebhook', '/api/webhook/test', {
            method: 'POST',
            body: {},
            headers,
          });
          expect(res.status, JSON.stringify(headers)).toBe(sent.at(-1)?.response?.status);
          expect(sent.length).toBeGreaterThan(0);
        }
        const settings = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };
        const put = await call('/api/receiver', {
          method: 'PUT',
          body: settings,
          headers: {
            Origin: new URL(base).origin,
            'Sec-Fetch-Site': 'same-origin',
            'content-type': 'application/json; charset=utf-8',
          },
        });
        expect(put.json).toEqual(settings);
      });

      it('X-Client-Request-Id in a wrong format: 400 example_invalid_request, no platform call', async () => {
        const mark = gateway.requests.length;
        const res = await call('/api/account', { headers: { 'X-Client-Request-Id': 'has spaces in it' } });
        await expectExampleError(res, 400, 'example_invalid_request', 'X-Client-Request-Id');
        expect(res.callId, 'X-Example-Call-Id on every passthrough answer').toMatch(UUID_RE);
        expect(gateway.since(mark)).toEqual([]);
      });

      it('upstream timeout: 504 example_upstream_timeout, logged with transportError timeout', async () => {
        gateway.inject('sendTestWebhook', { delayMs: UPSTREAM_TIMEOUT_MS + 2000, json: {} });
        const mark = gateway.requests.length;
        const res = await call('/api/webhook/test', { method: 'POST', body: {} });
        await expectExampleError(res, 504, 'example_upstream_timeout');
        expect(res.json).toMatchObject({ details: { timeoutMs: expect.any(Number) } });
        await expectFailedAttemptLogged(res, mark, 'timeout');
      });

      it('connection closed without an answer: 502 example_upstream_unreachable', async () => {
        gateway.inject('sendTestWebhook', { destroy: true });
        const mark = gateway.requests.length;
        const res = await call('/api/webhook/test', { method: 'POST', body: {} });
        await expectExampleError(res, 502, 'example_upstream_unreachable');
        await expectFailedAttemptLogged(res, mark, 'network');
      });

      it('an answer that is not the platform’s: 502 example_upstream_bad_response', async () => {
        gateway.inject('sendTestWebhook', {
          status: 502,
          text: '<html><body>502 Bad Gateway</body></html>',
          contentType: 'text/html',
        });
        const mark = gateway.requests.length;
        const res = await call('/api/webhook/test', { method: 'POST', body: {} });
        await expectExampleError(res, 502, 'example_upstream_bad_response');
        expect(res.json).toMatchObject({ details: { status: 502 } });
        expect(res.callId).toMatch(UUID_RE);
        const log = await logOf(res.callId ?? '');
        expect(log).toHaveLength(gateway.since(mark).length);
        expect(log.at(-1)).toMatchObject({ status: 502, transportError: null, operationId: 'sendTestWebhook' });
      });

      it('an unknown route: 404 example_not_found', async () => {
        await expectExampleError(await call('/api/no-such-route'), 404, 'example_not_found');
      });

      it('an unknown request-log entry and received webhook: 404 example_not_found', async () => {
        await expectExampleError(await call(`/api/request-log/${IDS.invoice}`), 404, 'example_not_found');
        await expectExampleError(await call(`/api/received-webhooks/${IDS.invoice}`), 404, 'example_not_found');
      });

      it('a bad request-log filter: 400 example_invalid_request', async () => {
        await expectExampleError(await call('/api/request-log?status=7xx'), 400, 'example_invalid_request', 'status');
      });
    });

    async function expectFailedAttemptLogged(res: Answer, mark: number, code: 'timeout' | 'network'): Promise<void> {
      expect(res.callId, 'X-Example-Call-Id on a backend-own upstream error').toMatch(UUID_RE);
      const sent = gateway.since(mark);
      expect(sent.length).toBeGreaterThanOrEqual(1);
      if (name === 'plain') expect(sent).toHaveLength(1);
      const log = await logOf(res.callId ?? '');
      expect(log).toHaveLength(sent.length);
      expect(log.at(-1)).toMatchObject({
        operationId: 'sendTestWebhook',
        status: null,
        requestId: null,
        transportError: { code },
      });
    }

    // ---------------------------------------------------------------------------------------- request log

    describe('request log', () => {
      it('filters by operationId and status class, and pages', async () => {
        const byOp = await call('/api/request-log?operationId=createInvoice&limit=200');
        const items = (byOp.json as { items: LogItem[] }).items;
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.operationId === 'createInvoice')).toBe(true);
        const errors = await call('/api/request-log?status=4xx&limit=200');
        const errItems = (errors.json as { items: LogItem[] }).items;
        expect(errItems.length).toBeGreaterThan(0);
        expect(errItems.every((i) => i.status !== null && i.status >= 400 && i.status < 500)).toBe(true);
        const page = await call('/api/request-log?limit=1&page=2');
        expect(page.json).toMatchObject({ page: 2, limit: 1, items: [expect.any(Object)] });
        expectValid(validateResponse('listRequestLog', 200, page.contentType, page.json), 'request-log page');
      });
    });

    // ---------------------------------------------------------------------------------------- SSE

    describe('GET /api/stream', () => {
      it('sends ready, a request event per attempt and a webhook event per received webhook', async () => {
        const stream = await openSse(`${base}/api/stream`);
        try {
          expect(stream.status).toBe(200);
          expect(stream.headers.get('content-type')).toMatch(/^text\/event-stream/);
          const ready = await stream.waitFor((e) => e.event === 'ready');
          expect(JSON.parse(ready.data)).toMatchObject({ backend: name });
          expectValid(validateAt('#/paths/~1api~1stream/get/x-sse-events/ready', JSON.parse(ready.data)), 'SSE ready');

          const res = await call('/api/tariff');
          const event = await stream.waitFor(
            (e) => e.event === 'request' && (JSON.parse(e.data) as LogItem).callId === res.callId,
          );
          const item = JSON.parse(event.data) as LogItem;
          expectValid(validateSchema('RequestLogItem', item), 'SSE request');
          expect(item).toMatchObject({ operationId: 'getMerchantTariff', status: 200 });
          expect(event.id).toBe(item.id);

          const poll = await call('/api/tariff', { headers: { 'X-Example-Source': 'poll' } });
          const polled = await stream.waitFor(
            (e) => e.event === 'request' && (JSON.parse(e.data) as LogItem).callId === poll.callId,
          );
          expect(JSON.parse(polled.data)).toMatchObject({ source: 'poll' });

          const sent = await gateway.sendWebhook(`${base}/webhooks/psp`);
          const hook = await stream.waitFor(
            (e) => e.event === 'webhook' && JSON.parse(e.data).webhookId === sent.request.headers['x-webhook-id'],
          );
          expectValid(validateSchema('ReceivedWebhookItem', JSON.parse(hook.data)), 'SSE webhook');
        } finally {
          stream.close();
        }
      });
    });

    // ---------------------------------------------------------------------------------------- receiver

    describe('POST /webhooks/psp', () => {
      const hookUrl = (): string => `${base}/webhooks/psp`;

      async function received(sent: SentWebhook): Promise<Record<string, unknown>> {
        const id = sent.request.headers['x-webhook-id'] ?? '';
        const list = await call(`/api/received-webhooks?webhookId=${id}&limit=200`);
        expect(list.status).toBe(200);
        expectValid(
          validateResponse('listReceivedWebhooks', 200, list.contentType, list.json),
          'received-webhooks list',
        );
        const items = (list.json as { items: { id: string }[] }).items;
        expect(items.length, 'the webhook is in the received-webhooks log').toBeGreaterThan(0);
        const newest = items[0] as { id: string };
        const one = await call(`/api/received-webhooks/${newest.id}`);
        expect(one.status).toBe(200);
        expectValid(validateResponse('getReceivedWebhook', 200, one.contentType, one.json), 'received webhook');
        const json = one.json as Record<string, unknown>;
        const bytes = Buffer.from(sent.request.body, 'utf8');
        expect((json['verify'] as { bodyBytes?: unknown }).bodyBytes, 'verify.bodyBytes: the full size').toBe(
          bytes.length,
        );
        if ((json['verify'] as { signatureValid?: unknown }).signatureValid === true) {
          expect(json['body'], 'the raw body as received').toBe(sent.request.body);
          expect(json['bodyTruncated']).toBe(false);
        } else {
          // From anyone: only the start of the body, not parsed
          expect(json['body'], 'the first 512 bytes of an unverified body').toBe(
            bytes.subarray(0, UNVERIFIED_BODY_BYTES).toString('utf8'),
          );
          expect(json['bodyTruncated']).toBe(bytes.length > UNVERIFIED_BODY_BYTES);
          expect(json['json'], 'an unverified body is not parsed').toBeNull();
        }
        expect(json['responseStatus']).toBe(sent.status);
        expectNoSecret(one.text, 'a received webhook');
        return json;
      }

      it('a valid webhook: 200 {received, duplicate: false}, logged as verified', async () => {
        const sent = await gateway.sendWebhook(hookUrl());
        expect(sent.status).toBe(200);
        expect(sent.json).toEqual({ received: true, duplicate: false });
        const entry = await received(sent);
        expect(entry).toMatchObject({
          verifyResult: 'ok',
          signedWith: 'current',
          duplicate: false,
          event: 'invoice.paid',
          attempt: 1,
          invoiceId: IDS.invoice,
          invoiceStatus: 'paid',
          verify: {
            result: 'ok',
            signatureValid: true,
            expectedSignature: sent.request.headers['x-webhook-signature'],
          },
        });
      });

      it('the same X-Webhook-Id again: 200, flagged as a duplicate', async () => {
        const first = await gateway.sendWebhook(hookUrl());
        const id = first.request.headers['x-webhook-id'];
        const again = await gateway.sendWebhook(hookUrl(), { id, attempt: 2 });
        expect(again.status).toBe(200);
        expect(again.json).toEqual({ received: true, duplicate: true });
        expect(await received(again)).toMatchObject({ verifyResult: 'ok', duplicate: true, attempt: 2 });
      });

      it('a bad signature: 401 signature_mismatch, logged', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), {
          secret: 'psp_sk_test_WrongSecretWrongSecretWrongSecret12',
        });
        expect(sent.status).toBe(401);
        expect(sent.json).toMatchObject({ errorCode: 'signature_mismatch' });
        expectValid(validateSchema('ReceiverRefusal', sent.json), 'receiver refusal');
        const entry = await received(sent);
        expect(entry).toMatchObject({
          verifyResult: 'signature_mismatch',
          signedWith: null,
          invoiceId: null,
          bodyTruncated: true,
          json: null,
          verify: { signatureValid: false },
        });
        expect(sent.request.body.length, 'the suite sends more than 512 bytes here').toBeGreaterThan(
          UNVERIFIED_BODY_BYTES,
        );
      });

      it('an old timestamp: 401 timestamp_out_of_window, logged with a valid signature', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), { timestamp: Math.floor(Date.now() / 1000) - 600 });
        expect(sent.status).toBe(401);
        expect(sent.json).toMatchObject({ errorCode: 'timestamp_out_of_window' });
        expect(await received(sent)).toMatchObject({
          verifyResult: 'timestamp_out_of_window',
          verify: { signatureValid: true },
        });
      });

      it('signed with PSP_API_PREVIOUS_SECRET: accepted, signedWith previous', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), { secret: TEST_PREVIOUS_SECRET, type: 'webhook.test' });
        expect(sent.status).toBe(200);
        expect(await received(sent)).toMatchObject({
          verifyResult: 'ok',
          signedWith: 'previous',
          event: 'webhook.test',
        });
      });

      it('a missing signature header: 401 missing_header', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), { omitHeaders: ['x-webhook-signature'] });
        expect(sent.status).toBe(401);
        expect(sent.json).toMatchObject({ errorCode: 'missing_header' });
        expect(await received(sent)).toMatchObject({ verifyResult: 'missing_header' });
      });

      it('an id of the body other than X-Webhook-Id: 400 id_mismatch', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), { fields: { id: IDS.delivery } });
        expect(sent.status).toBe(400);
        expect(sent.json).toMatchObject({ errorCode: 'id_mismatch' });
        expect(await received(sent)).toMatchObject({ verifyResult: 'id_mismatch', verify: { signatureValid: true } });
      });

      it('a mainnet webhook to a testnet key: 401 chain_mismatch', async () => {
        const sent = await gateway.sendWebhook(hookUrl(), { fields: { chain: 'mainnet' } });
        expect(sent.status).toBe(401);
        expect(sent.json).toMatchObject({ errorCode: 'chain_mismatch' });
      });

      it('receiver settings change the answer: fixed, failNext, delayMs; bad settings are refused', async () => {
        const defaults = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };
        const initial = await call('/api/receiver');
        expect(initial.json).toEqual(defaults);
        expectValid(
          validateResponse('getReceiverSettings', 200, initial.contentType, initial.json),
          'receiver settings',
        );
        try {
          const fixed = await call('/api/receiver', {
            method: 'PUT',
            body: { mode: 'fixed', status: 503, delayMs: 0, failNext: 0 },
          });
          expect(fixed.json).toEqual({ mode: 'fixed', status: 503, delayMs: 0, failNext: 0 });
          const a = await gateway.sendWebhook(hookUrl());
          expect(a.status).toBe(503);
          expect(a.json).toEqual({ forced: 'fixed' });
          expect(await received(a)).toMatchObject({ verifyResult: 'ok', responseStatus: 503 });

          await call('/api/receiver', { method: 'PUT', body: { mode: 'auto', status: 500, delayMs: 0, failNext: 2 } });
          const b1 = await gateway.sendWebhook(hookUrl());
          const b2 = await gateway.sendWebhook(hookUrl());
          const b3 = await gateway.sendWebhook(hookUrl());
          expect([b1.status, b2.status, b3.status]).toEqual([500, 500, 200]);
          expect(b1.json).toEqual({ forced: 'fail_next' });
          expect((await call('/api/receiver')).json).toMatchObject({ failNext: 0 });

          await call('/api/receiver', {
            method: 'PUT',
            body: { mode: 'auto', status: 500, delayMs: 400, failNext: 0 },
          });
          const slow = await gateway.sendWebhook(hookUrl());
          expect(slow.status).toBe(200);
          expect(slow.elapsedMs).toBeGreaterThanOrEqual(380);
          expect(await received(slow)).toMatchObject({ responseDelayMs: 400 });

          const bad = await call('/api/receiver', {
            method: 'PUT',
            body: { mode: 'auto', status: 99, delayMs: 0, failNext: 0 },
          });
          await expectExampleError(bad, 400, 'example_invalid_request', 'status');
        } finally {
          await call('/api/receiver', { method: 'PUT', body: defaults });
        }
      });

      it('a body over 64 KB: 413 example_payload_too_large, not logged; a signed 64 KB webhook is accepted', async () => {
        const before = (await call('/api/received-webhooks?limit=1')).json as { total: number };
        const padTo = (size: number, id: string): string => {
          const body = webhookBody('invoice.paid', id, { pad: '' });
          return webhookBody('invoice.paid', id, { pad: 'x'.repeat(size - Buffer.byteLength(body)) });
        };
        const tooLargeId = fakeUuid(`too-large:${Date.now()}`);
        const tooLarge = await gateway.sendWebhook(hookUrl(), {
          id: tooLargeId,
          body: padTo(WEBHOOK_BODY_LIMIT + 1, tooLargeId),
        });
        await expectExampleError(
          { ...tooLarge, contentType: tooLarge.headers.get('content-type') ?? '', callId: null },
          413,
          'example_payload_too_large',
        );
        expect(tooLarge.json).toMatchObject({ details: { limitBytes: WEBHOOK_BODY_LIMIT } });
        const after = (await call('/api/received-webhooks?limit=1')).json as { total: number };
        expect(after.total, 'a refused oversized body is not logged').toBe(before.total);

        const fullId = fakeUuid(`full-size:${Date.now()}`);
        const full = await gateway.sendWebhook(hookUrl(), { id: fullId, body: padTo(WEBHOOK_BODY_LIMIT, fullId) });
        expect(Buffer.byteLength(full.request.body)).toBe(WEBHOOK_BODY_LIMIT);
        expect(full.status).toBe(200);
        expect(await received(full)).toMatchObject({ verifyResult: 'ok', bodyTruncated: false });
      });

      it('the log filters failed webhooks and can be cleared', async () => {
        const failed = await call('/api/received-webhooks?result=failed&limit=200');
        const items = (failed.json as { items: { verifyResult: string }[] }).items;
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.verifyResult !== 'ok')).toBe(true);
        const cleared = await call('/api/received-webhooks', { method: 'DELETE' });
        expect(cleared.status).toBe(204);
        expect((await call('/api/received-webhooks')).json).toMatchObject({ items: [], total: 0 });
      });

      it('unsigned requests keep a ring of their own: a flood does not push a valid webhook out', async () => {
        const valid = await gateway.sendWebhook(hookUrl());
        expect(valid.status).toBe(200);
        const flood = UNVERIFIED_LIMIT + 50;
        for (let i = 0; i < flood; i++) {
          const junk = await gateway.sendWebhook(hookUrl(), { omitHeaders: ['x-webhook-signature'] });
          expect(junk.status).toBe(401);
        }
        expect(await received(valid), 'the valid webhook is still in the log').toMatchObject({ verifyResult: 'ok' });
        const failed = (await call('/api/received-webhooks?result=failed&limit=1')).json as { total: number };
        expect(failed.total, `the last ${UNVERIFIED_LIMIT} unsigned requests are kept`).toBe(UNVERIFIED_LIMIT);
        const all = (await call('/api/received-webhooks?limit=1')).json as { total: number };
        expect(all.total).toBe(UNVERIFIED_LIMIT + 1);
        expect((await call('/api/received-webhooks', { method: 'DELETE' })).status).toBe(204);
      });
    });

    // ---------------------------------------------------------------------------------------- widget link

    describe('POST /api/invoices/{invoiceId}/checkout-link', () => {
      it('signs a link on PSP_CHECKOUT_URL with branding, locale and expiry (gateway 20.2)', async () => {
        const branding = {
          companyName: 'Shop Example',
          logoUrl: 'https://shop.example/logo.png',
          accentColor: '#4f46e5',
          theme: 'auto',
          title: 'Заказ 10530',
        };
        const mark = gateway.requests.length;
        const before = Math.floor(Date.now() / 1000);
        const res = await call(`/api/invoices/${IDS.invoice}/checkout-link`, {
          method: 'POST',
          body: { branding, locale: 'ru', expiresInSeconds: 3600 },
        });
        expect(res.status).toBe(200);
        expectValid(validateResponse('createCheckoutLink', 200, res.contentType, res.json), 'checkout link');
        const link = res.json as { url: string; token: string; expiresAt: string };
        expect(link.url).toBe(`${CHECKOUT_URL}/#${link.token}`);
        const check = verifyCheckoutToken(link.token, TEST_SECRET);
        expect(check).toMatchObject({ valid: true, payload: { k: TEST_KEY, i: IDS.invoice, b: branding, l: 'ru' } });
        const e = check.valid ? check.payload.e : 0;
        expect(e).toBeGreaterThanOrEqual(before + 3600);
        expect(e).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600);
        expect(Date.parse(link.expiresAt) / 1000).toBe(e);
        expect(gateway.since(mark), 'the link is built offline').toEqual([]);
        expectNoSecret(res.text.split(link.token).join(''), 'the checkout-link answer');
      });

      it('without options: 24 h, no branding, no locale', async () => {
        const res = await call(`/api/invoices/${IDS.invoice}/checkout-link`, { method: 'POST' });
        expect(res.status).toBe(200);
        const check = verifyCheckoutToken((res.json as { token: string }).token, TEST_SECRET);
        expect(check.valid).toBe(true);
        if (check.valid) {
          expect(check.payload.b).toBeUndefined();
          expect(check.payload.l).toBeUndefined();
          expect(Math.abs(check.payload.e - (Math.floor(Date.now() / 1000) + 86_400))).toBeLessThanOrEqual(5);
        }
      });

      it('bad options and a bad invoice id: 400 example_invalid_request, details.field the path in the body', async () => {
        const link = (body: unknown) => call(`/api/invoices/${IDS.invoice}/checkout-link`, { method: 'POST', body });
        const code = 'example_invalid_request';
        await expectExampleError(await link({ branding: { accentColor: 'red' } }), 400, code, 'branding.accentColor');
        await expectExampleError(
          await link({ branding: { logoUrl: 'http://shop.example/logo.png' } }),
          400,
          code,
          'branding.logoUrl',
        );
        await expectExampleError(await link({ branding: { logo_url: 'x' } }), 400, code, 'branding.logo_url');
        await expectExampleError(await link({ expiresInSeconds: 604_801 }), 400, code, 'expiresInSeconds');
        await expectExampleError(await link({ locale: 'de' }), 400, code, 'locale');
        const upper = await call(`/api/invoices/${IDS.invoice.toUpperCase()}/checkout-link`, { method: 'POST' });
        await expectExampleError(upper, 400, code, 'invoiceId');
      });
    });

    // ---------------------------------------------------------------------------------------- coverage

    it('coverage: the request log holds every one of the 27 Merchant API operations', async () => {
      const seen = new Set<string>();
      for (let page = 1; ; page++) {
        const res = await call(`/api/request-log?limit=200&page=${page}`);
        const { items, total } = res.json as { items: LogItem[]; total: number };
        for (const item of items) seen.add(item.operationId);
        if (items.length === 0 || page * 200 >= total) break;
      }
      expect(
        MERCHANT_OPERATION_IDS.filter((id) => !seen.has(id)),
        'operations never called through the backend',
      ).toEqual([]);
      expect(
        gateway.requests.every((r) => r.auth.ok),
        'every platform request was correctly signed',
      ).toBe(true);
    });
  });
}
