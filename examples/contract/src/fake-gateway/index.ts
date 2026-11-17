// A fake Merchant API for the conformance suite and the backends' own tests: an in-process node:http server with all
// 27 operations at /api/v1/*. It checks the v1 signature of every request like gateway (13.2–13.4), validates query
// names, the body and X-Client-Request-Id (13.4 step 12), answers with the documented examples of
// merchant-api.v1.json (deterministic, schema-shaped), keeps invoices and payouts by externalId (201 / 200 / 409),
// records every request with its answer, and lets a test script the next answers of an operation. It also sends
// signed webhooks (webhook-service 13.6) to a URL.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import {
  merchantBodySchema,
  merchantErrorExample,
  merchantExample,
  merchantOperations,
  merchantQueryNames,
  successStatuses,
} from '../internal/contract.js';
import { safeEqual, signApiRequest, signWebhook } from '../internal/crypto.js';

export {
  signApiRequest,
  signWebhook,
  verifyCheckoutToken,
  signCheckoutPayload,
  sha256Hex,
} from '../internal/crypto.js';
export type { CheckoutPayload, CheckoutTokenCheck } from '../internal/crypto.js';

/** The test key (made up). */
export const TEST_KEY = 'psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
/** The made-up secret of the gateway docs (13.5), with the testnet prefix. */
export const TEST_SECRET = 'psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
/** A made-up previous secret, for webhooks signed during a rotation. */
export const TEST_PREVIOUS_SECRET = 'psp_sk_test_Pr3v10usS3cr3tR0tat10nW1nd0wQxZ7k';
/** A made-up live key and secret: a backend with `APP_TESTNET_ONLY=true` must refuse to start with them. */
export const LIVE_KEY = 'psp_pk_live_7Hq2Wd5Lx9Mz3Rv8Nc1Bt6Ky';
export const LIVE_SECRET = 'psp_sk_live_4Fg8Jk2Lm6Np9Qr3St7Vw1Xy5Za0Bc8De2Gh';
/** The invoice of the documentation examples; webhooks built by {@link webhookBody} are about it. */
export const TEST_INVOICE_ID = '97da92f5-45c0-411b-9ed5-6793b396cd5f';
/** merchantId of the documentation examples. */
export const TEST_MERCHANT_ID = '6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13';

const TIMESTAMP_WINDOW_SECONDS = 300;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const CLIENT_REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;
const BODY_LIMIT = 65_536;

type Json = Record<string, unknown>;

/** A scripted answer. */
export interface Reply {
  status?: number;
  /** JSON body. */
  json?: unknown;
  /** Raw body text (with `contentType`, default `text/plain`). */
  text?: string;
  contentType?: string;
  /** Extra answer headers, e.g. `Retry-After`, `X-Api-Key-Deprecated`. */
  headers?: Record<string, string>;
  /** Wait before answering, ms (to trigger a client timeout). */
  delayMs?: number;
  /** Close the connection without an answer. */
  destroy?: boolean;
}

export interface RecordedRequest {
  /** 1, 2, … in arrival order. */
  seq: number;
  /** The Merchant API operation of the method and path; null — no such route. */
  operationId: string | null;
  method: string;
  /** Path and query exactly as in the request line. */
  target: string;
  path: string;
  /** Decoded query pairs in order. */
  query: [string, string][];
  /** Request headers, names in lower case. */
  headers: Record<string, string>;
  body: string;
  /** The signature check: `ok`, or the `details.reason` of the `401 api_auth_failed` answer. */
  auth: { ok: boolean; reason: string | null; stringToSign: string | null };
  /** The answer; null — none was sent (connection closed, or the client went away first). */
  response: { status: number; headers: Record<string, string>; body: string } | null;
}

export interface InjectOptions {
  /** How many next calls of the operation get this answer: a number (default 1) or `always` until cleared. */
  times?: number | 'always';
}

export interface WebhookOptions {
  /** `X-Webhook-Event` and `type`, default `invoice.paid`. */
  type?: string;
  /** `X-Webhook-Id` and `id`. Default: a new deterministic uuid. */
  id?: string;
  /** The full body; default built by {@link webhookBody}. */
  body?: string;
  /** Overrides of the default body fields (`chain`, `merchantId`, `data`, …). */
  fields?: Json;
  /** Secret that signs; default {@link TEST_SECRET}. */
  secret?: string;
  /** `X-Webhook-Timestamp`, unix seconds; default now. */
  timestamp?: number;
  /** A signature to send instead of the computed one. */
  signature?: string;
  attempt?: number;
  /** Headers to leave out, e.g. `x-webhook-signature`. */
  omitHeaders?: string[];
  /** Headers to set over the computed ones (e.g. a different `X-Webhook-Id`). */
  headers?: Record<string, string>;
}

export interface SentWebhook {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
  elapsedMs: number;
  /** What was sent. */
  request: { headers: Record<string, string>; body: string };
}

export interface FakeGateway {
  /** Base URL, e.g. `http://127.0.0.1:41234` — the `PSP_API_URL` of a backend. */
  url: string;
  key: string;
  secret: string;
  requests: RecordedRequest[];
  /** Requests from index `from` on (use `requests.length` as a mark before a call), optionally of one operation. */
  since(from: number, operationId?: string): RecordedRequest[];
  /** The next calls of the operation get `reply` (after a valid signature). */
  inject(operationId: string, reply: Reply | ((req: RecordedRequest) => Reply), options?: InjectOptions): void;
  /**
   * The next call gets a platform error: the documented example of `errorCode` for this operation when there is one,
   * otherwise `{errorCode, errorMessage, details}` with the given status.
   */
  injectError(
    operationId: string,
    errorCode: string,
    options?: { status?: number; details?: unknown; headers?: Record<string, string> } & InjectOptions,
  ): void;
  clearInjections(): void;
  /** Forgets requests, injections, invoices and payouts. */
  reset(): void;
  /** Signs and POSTs a webhook to `url`. */
  sendWebhook(url: string, options?: WebhookOptions): Promise<SentWebhook>;
  close(): Promise<void>;
}

const sha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

/** A deterministic uuid v4-shaped id from a seed. */
export function fakeUuid(seed: string): string {
  const h = sha256(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const apiError = (errorCode: string, errorMessage: string, details: unknown = null): Json => ({
  errorCode,
  errorMessage,
  details,
});

interface Route {
  operationId: string;
  method: string;
  re: RegExp;
  params: string[];
}

const ROUTES: Route[] = merchantOperations.map(({ operationId, method, path }) => {
  const params: string[] = [];
  const re = new RegExp(
    `^${path.replace(/\{(\w+)\}/g, (_, name: string) => {
      params.push(name);
      return '([^/]+)';
    })}$`,
  );
  return { operationId, method, re, params };
});

function match(method: string, path: string): { operationId: string; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = route.re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.params.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? '');
    });
    return { operationId: route.operationId, params };
  }
  return null;
}

const flat = (headers: IncomingMessage['headers']): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v]])),
  );

/** gateway 13.4 steps 5–9. Returns null when the signature is right, otherwise the `details` of the 401. */
function checkSignature(
  req: RecordedRequest,
  key: string,
  secret: string,
  nonces: Set<string>,
  now: number,
): { details: Json | null; stringToSign: string | null } {
  const h = req.headers;
  const formats: [string, RegExp][] = [
    ['x-api-key', KEY_RE],
    ['x-api-timestamp', /^\d{10}$/],
    ['x-api-nonce', NONCE_RE],
    ['x-api-signature', /^v1=[0-9a-f]{64}$/],
  ];
  for (const [name, re] of formats) {
    const value = h[name];
    if (value === undefined || value === '')
      return { details: { reason: 'missing_header', header: name }, stringToSign: null };
    if (!re.test(value)) return { details: { reason: 'malformed_header', header: name }, stringToSign: null };
  }
  const ts = Number(h['x-api-timestamp']);
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_SECONDS) {
    return { details: { reason: 'timestamp_out_of_window', serverTime: now }, stringToSign: null };
  }
  if (h['x-api-key'] !== key) return { details: { reason: 'unknown_key' }, stringToSign: null };
  const { stringToSign, signature } = signApiRequest({
    secret,
    method: req.method,
    target: req.target,
    timestamp: h['x-api-timestamp'] ?? '',
    nonce: h['x-api-nonce'] ?? '',
    body: req.body,
  });
  if (!safeEqual(signature, h['x-api-signature'] ?? ''))
    return { details: { reason: 'bad_signature', stringToSign }, stringToSign };
  const nonce = h['x-api-nonce'] ?? '';
  if (nonces.has(nonce)) return { details: { reason: 'nonce_reused' }, stringToSign };
  nonces.add(nonce);
  return { details: null, stringToSign };
}

/** gateway 13.4 step 12: parameter names, the body and `X-Client-Request-Id`. */
function validateRequest(req: RecordedRequest, operationId: string): Json | null {
  const fields: Json[] = [];
  const clientRequestId = req.headers['x-client-request-id'];
  if (clientRequestId !== undefined && !CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
    fields.push({ field: 'x-client-request-id', message: 'must be 1-128 printable ASCII characters' });
  }
  const known = merchantQueryNames(operationId);
  for (const [name] of req.query) {
    if (!known.has(name)) fields.push({ field: name, message: `property ${name} should not exist` });
  }
  const schema = merchantBodySchema(operationId);
  if (req.body !== '') {
    let body: unknown;
    try {
      body = JSON.parse(req.body);
    } catch {
      return { fields: [{ field: 'body', message: 'body must be JSON' }] };
    }
    if (!schema) fields.push({ field: 'body', message: 'the method takes no body' });
    else if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      fields.push({ field: 'body', message: 'body must be an object' });
    } else {
      const properties = (schema['properties'] as Json | undefined) ?? {};
      for (const name of Object.keys(body)) {
        if (!(name in properties)) fields.push({ field: name, message: `property ${name} should not exist` });
      }
      for (const name of (schema['required'] as string[] | undefined) ?? []) {
        if (!(name in body)) fields.push({ field: name, message: `${name} should not be empty` });
      }
    }
  } else if (schema && merchantRequiresBody(operationId)) {
    fields.push({ field: 'body', message: 'body is required' });
  }
  return fields.length ? { fields } : null;
}

const merchantRequiresBody = (operationId: string): boolean =>
  ['createInvoice', 'quotePayout', 'createPayout', 'setWebhookUrl'].includes(operationId);

interface Stored {
  fields: string;
  object: Json;
}

/** Starts the fake gateway on 127.0.0.1 and a free port. */
export async function startFakeGateway(options: { key?: string; secret?: string } = {}): Promise<FakeGateway> {
  const key = options.key ?? TEST_KEY;
  const secret = options.secret ?? TEST_SECRET;
  const nonces = new Set<string>();
  const sockets = new Set<Socket>();
  const injections = new Map<string, { reply: Reply | ((req: RecordedRequest) => Reply); left: number }[]>();
  const invoices = new Map<string, Stored>();
  const payouts = new Map<string, Stored>();
  const requests: RecordedRequest[] = [];
  let seq = 0;
  let webhookSeq = 0;

  const takeInjection = (operationId: string, req: RecordedRequest): Reply | null => {
    const queue = injections.get(operationId);
    const head = queue?.[0];
    if (!queue || !head) return null;
    if (Number.isFinite(head.left)) {
      head.left -= 1;
      if (head.left <= 0) queue.shift();
    }
    return typeof head.reply === 'function' ? head.reply(req) : head.reply;
  };

  const create = (store: Map<string, Stored>, operationId: string, prefix: string, body: Json): Reply => {
    const externalId = String(body['externalId']);
    const fields = JSON.stringify(
      Object.entries(body)
        .filter(([k]) => k !== 'quoteId')
        .sort(),
    );
    const existing = store.get(externalId);
    if (existing) {
      if (existing.fields !== fields) {
        const code = prefix === 'invoice' ? 'invoice_conflict' : 'payout_conflict';
        const idField = prefix === 'invoice' ? 'invoiceId' : 'payoutId';
        return {
          status: 409,
          json: apiError(code, `externalId ${externalId} belongs to another ${prefix}`, {
            [idField]: existing.object['id'],
          }),
        };
      }
      return { status: 200, json: existing.object };
    }
    const object = { ...(merchantExample(operationId, 201) as Json) };
    for (const [k, v] of Object.entries(body)) if (k in object) object[k] = v;
    object['id'] = fakeUuid(`${prefix}:${externalId}`);
    store.set(externalId, { fields, object });
    return { status: 201, json: object };
  };

  /** The default answer of an operation: its documented example, adapted to the request. */
  const answer = (operationId: string, params: Record<string, string>, req: RecordedRequest): Reply => {
    const body = req.body ? (JSON.parse(req.body) as Json) : {};
    if (operationId === 'createInvoice') return create(invoices, operationId, 'invoice', body);
    if (operationId === 'createPayout') return create(payouts, operationId, 'payout', body);
    if (operationId === 'getMerchantOperationsStatement' && req.query.some(([k, v]) => k === 'format' && v === 'csv')) {
      return {
        status: 200,
        text: String(merchantExample(operationId, 200, 'text/csv')),
        contentType: 'text/csv; charset=utf-8',
      };
    }
    const status = successStatuses(operationId)[0] ?? 200;
    const example = merchantExample(operationId, status);
    const ids = Object.values(params);
    if (ids.length === 1 && example !== null && typeof example === 'object' && 'id' in example) {
      (example as Json)['id'] = ids[0];
    }
    return { status, json: example };
  };

  const send = (res: ServerResponse, recorded: RecordedRequest, reply: Reply): void => {
    const respond = (): void => {
      if (res.destroyed || res.writableEnded) return;
      if (reply.destroy) {
        res.socket?.destroy();
        return;
      }
      const status = reply.status ?? 200;
      const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
      const headers: Record<string, string> = {
        'content-type':
          reply.text !== undefined
            ? (reply.contentType ?? 'text/plain; charset=utf-8')
            : 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-request-id': fakeUuid(`request:${recorded.seq}`),
      };
      const clientRequestId = recorded.headers['x-client-request-id'];
      if (clientRequestId !== undefined && CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
        headers['x-client-request-id'] = clientRequestId;
      }
      for (const [k, v] of Object.entries(reply.headers ?? {})) headers[k.toLowerCase()] = v;
      recorded.response = { status, headers, body: text };
      res.writeHead(status, headers);
      res.end(text);
    };
    if (reply.delayMs) setTimeout(respond, reply.delayMs);
    else respond();
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= BODY_LIMIT + 1) chunks.push(c);
    });
    req.on('end', () => {
      const target = req.url ?? '/';
      const url = new URL(target, 'http://fake.gateway');
      const method = req.method ?? 'GET';
      const found = match(method, url.pathname);
      const recorded: RecordedRequest = {
        seq: ++seq,
        operationId: found?.operationId ?? null,
        method,
        target,
        path: url.pathname,
        query: [...url.searchParams.entries()],
        headers: flat(req.headers),
        body: Buffer.concat(chunks).toString('utf8'),
        auth: { ok: false, reason: null, stringToSign: null },
        response: null,
      };
      requests.push(recorded);
      // 13.4: 1 — the route, 2 — the size, 5–9 — the signature, then the injected answer, 12 — the parameters
      if (!found)
        return send(res, recorded, {
          status: 404,
          json: apiError('not_found', 'Route not found', { object: 'route', id: null }),
        });
      if (size > BODY_LIMIT) {
        return send(res, recorded, {
          status: 413,
          json: apiError('payload_too_large', 'Body too large', { maxBytes: BODY_LIMIT }),
        });
      }
      const check = checkSignature(recorded, key, secret, nonces, Math.floor(Date.now() / 1000));
      recorded.auth = {
        ok: check.details === null,
        reason: (check.details?.['reason'] as string | undefined) ?? null,
        stringToSign: check.stringToSign,
      };
      if (check.details) {
        const messages: Record<string, string> = {
          missing_header: 'A signature header is missing',
          malformed_header: 'A signature header is malformed',
          timestamp_out_of_window: 'X-Api-Timestamp is outside the accepted window',
          unknown_key: 'Unknown API key',
          bad_signature: 'Request signature does not match',
          nonce_reused: 'The nonce has been used already',
        };
        const reason = String(check.details['reason']);
        return send(res, recorded, {
          status: 401,
          json: apiError('api_auth_failed', messages[reason] ?? reason, check.details),
        });
      }
      const injected = takeInjection(found.operationId, recorded);
      if (injected) return send(res, recorded, injected);
      const invalid = validateRequest(recorded, found.operationId);
      if (invalid)
        return send(res, recorded, {
          status: 400,
          json: apiError('invalid_schema', 'Request validation failed', invalid),
        });
      send(res, recorded, answer(found.operationId, found.params, recorded));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const gateway: FakeGateway = {
    url,
    key,
    secret,
    requests,
    since: (from, operationId) =>
      requests.slice(from).filter((r) => operationId === undefined || r.operationId === operationId),
    inject(operationId, reply, opts = {}) {
      if (!ROUTES.some((r) => r.operationId === operationId)) throw new Error(`no operation ${operationId}`);
      const left = opts.times === 'always' ? Number.POSITIVE_INFINITY : (opts.times ?? 1);
      const queue = injections.get(operationId) ?? [];
      queue.push({ reply, left });
      injections.set(operationId, queue);
    },
    injectError(operationId, errorCode, opts = {}) {
      const documented = merchantErrorExample(operationId, errorCode);
      const status = opts.status ?? documented?.status ?? 400;
      const body = documented?.body ?? apiError(errorCode, `${errorCode} (fake gateway)`, opts.details ?? null);
      if (opts.details !== undefined) body['details'] = opts.details;
      gateway.inject(operationId, { status, json: body, headers: opts.headers ?? {} }, opts);
    },
    clearInjections: () => injections.clear(),
    reset() {
      requests.length = 0;
      injections.clear();
      invoices.clear();
      payouts.clear();
    },
    sendWebhook: (target, opts = {}) =>
      sendWebhook(target, { ...opts, id: opts.id ?? fakeUuid(`webhook:${++webhookSeq}:${Date.now()}`) }),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return gateway;
}

// ------------------------------------------------------------------------------------------------ webhooks

/** The body of a webhook (webhook-service 13.3), version 1, testnet chain `nile`, the documentation merchant. */
export function webhookBody(type = 'invoice.paid', id = fakeUuid(`webhook:${type}`), fields: Json = {}): string {
  const invoice: Json = { ...(merchantExample('getInvoice', 200) as Json), id: TEST_INVOICE_ID, status: 'paid' };
  delete invoice['payments'];
  const data: Json =
    type === 'webhook.test' ? { test: true, message: 'Conformance check' } : { invoice, payment: null };
  return JSON.stringify({
    id,
    type,
    version: 1,
    occurredAt: '2026-09-29T12:06:07.480Z',
    network: 'tron',
    chain: 'nile',
    merchantId: TEST_MERCHANT_ID,
    data,
    ...fields,
  });
}

/** Signs a webhook like webhook-service and POSTs it. Unless overridden, the headers match the body. */
export async function sendWebhook(url: string, options: WebhookOptions = {}): Promise<SentWebhook> {
  const type = options.type ?? 'invoice.paid';
  const id = options.id ?? fakeUuid(`webhook:${type}:${Date.now()}:${Math.random()}`);
  const body = options.body ?? webhookBody(type, id, options.fields);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'psp-webhooks/1.0',
    'x-webhook-id': id,
    'x-webhook-event': type,
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-signature': options.signature ?? signWebhook(options.secret ?? TEST_SECRET, timestamp, body),
    'x-webhook-attempt': String(options.attempt ?? 1),
  };
  for (const name of options.omitHeaders ?? []) delete headers[name.toLowerCase()];
  for (const [k, v] of Object.entries(options.headers ?? {})) headers[k.toLowerCase()] = v;
  const started = performance.now();
  const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual' });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return {
    status: res.status,
    headers: res.headers,
    text,
    json,
    elapsedMs: performance.now() - started,
    request: { headers, body },
  };
}
