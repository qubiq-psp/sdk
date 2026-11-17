// A minimal reference implementation of the contract (plain style, node:http, own signing), used only to test the
// conformance suite itself: if the suite fails here, the suite is wrong. Not an example to copy — the real backends
// live in examples/plain/api and examples/sdk/api.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import routesJson from '../src/routes.json' with { type: 'json' };
import { sha256Hex, signApiRequest, signCheckoutPayload, signWebhook, safeEqual } from '../src/internal/crypto.ts';
import type { ConformanceEnv, StartedBackend } from '../src/conformance/index.ts';

type Json = Record<string, unknown>;

interface Route {
  operationId: string;
  method: string;
  path: string;
  merchantApi: string | null;
}

const PASSED = ['x-request-id', 'x-client-request-id', 'x-api-key-deprecated', 'retry-after'];
const CLIENT_REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;
const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

const invalid = (field: string, message: string): HttpError =>
  new HttpError(400, 'example_invalid_request', message, { field, message });

export async function startReferenceBackend(env: ConformanceEnv): Promise<StartedBackend> {
  if (env.APP_TESTNET_ONLY === 'true' && env.PSP_API_KEY.startsWith('psp_pk_live_')) {
    throw new Error('APP_TESTNET_ONLY=true: a psp_pk_live_ key is refused');
  }
  const apiUrl = env.PSP_API_URL.replace(/\/$/, '');
  const timeoutMs = Number(env.APP_UPSTREAM_TIMEOUT_MS || 180_000);
  const secrets = [env.PSP_API_SECRET, env.PSP_API_PREVIOUS_SECRET].filter(Boolean);
  const log: Json[] = [];
  const webhooks: Json[] = [];
  const accepted = new Set<string>();
  let receiver = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };
  const streams = new Set<ServerResponse>();
  const emit = (event: string, data: Json): void => {
    for (const res of streams)
      res.write(`event: ${event}\nid: ${String(data['id'])}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const passthrough = (routesJson as Route[])
    .filter((r) => r.merchantApi)
    .map((r) => {
      const names: string[] = [];
      const re = new RegExp(`^${r.path.replace(/\{(\w+)\}/g, (_, n: string) => (names.push(n), '([^/]+)'))}$`);
      return { ...r, re, names };
    });

  const itemOf = (e: Json): Json => {
    const {
      url: _u,
      requestHeaders: _a,
      requestBody: _b,
      responseHeaders: _c,
      responseBody: _d,
      responseBodyTruncated: _e,
      signing: _f,
      ...item
    } = e;
    return item;
  };

  async function forward(
    route: (typeof passthrough)[number],
    target: string,
    req: IncomingMessage,
    body: string,
    callId: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const { stringToSign, signature } = signApiRequest({
      secret: env.PSP_API_SECRET,
      method: route.method,
      target,
      timestamp,
      nonce,
      body,
    });
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-api-key': env.PSP_API_KEY,
      'x-api-timestamp': timestamp,
      'x-api-nonce': nonce,
      'x-api-signature': signature,
    };
    if (body) headers['content-type'] = 'application/json';
    const clientRequestId = req.headers['x-client-request-id'] as string | undefined;
    if (clientRequestId !== undefined) headers['x-client-request-id'] = clientRequestId;
    const entry: Json = {
      id: randomUUID(),
      callId,
      createdAt: new Date().toISOString(),
      source: req.headers['x-example-source'] === 'poll' ? 'poll' : 'ui',
      operationId: route.merchantApi,
      sdkMethod: null,
      attempt: 1,
      method: route.method,
      path: target,
      status: null,
      errorCode: null,
      requestId: null,
      clientRequestId: clientRequestId ?? null,
      apiKeyDeprecatedUntil: null,
      durationMs: 0,
      transportError: null,
      url: `${apiUrl}${target}`,
      requestHeaders: headers,
      requestBody: body || null,
      responseHeaders: null,
      responseBody: null,
      responseBodyTruncated: false,
      signing: { stringToSign, bodySha256: sha256Hex(body) },
    };
    const started = performance.now();
    const finish = (): void => {
      entry['durationMs'] = Math.round(performance.now() - started);
      log.unshift(entry);
      emit('request', itemOf(entry));
    };
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${apiUrl}${target}`, {
        method: route.method,
        headers,
        body: body || undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const timeout = (err as Error).name === 'TimeoutError';
      entry['transportError'] = { code: timeout ? 'timeout' : 'network', message: String((err as Error).message) };
      finish();
      throw timeout
        ? new HttpError(504, 'example_upstream_timeout', `No answer in ${timeoutMs} ms`, { timeoutMs })
        : new HttpError(502, 'example_upstream_unreachable', 'No connection to the platform', {
            cause: String((err as Error).message),
          });
    }
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    Object.assign(entry, {
      status: res.status,
      requestId: resHeaders['x-request-id'] ?? null,
      apiKeyDeprecatedUntil: resHeaders['x-api-key-deprecated'] ?? null,
      responseHeaders: resHeaders,
      responseBody: text,
    });
    const contentType = resHeaders['content-type'] ?? '';
    let json: Json | null = null;
    if (contentType.includes('json')) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        json = null;
      }
    }
    if (res.status >= 400 && json && typeof json['errorCode'] === 'string') entry['errorCode'] = json['errorCode'];
    finish();
    const csvOk = res.status >= 200 && res.status < 300 && contentType.startsWith('text/csv');
    const ok = csvOk || (json !== null && (res.status < 300 ? text !== '' : typeof json['errorCode'] === 'string'));
    if (res.status >= 300 && res.status < 400) {
      throw new HttpError(502, 'example_upstream_bad_response', `Redirect ${res.status}`, {
        status: res.status,
        requestId: entry['requestId'],
        bodyPreview: text.slice(0, 200),
      });
    }
    if (!ok) {
      throw new HttpError(502, 'example_upstream_bad_response', `HTTP ${res.status} that is not the platform's`, {
        status: res.status,
        requestId: entry['requestId'],
        bodyPreview: text.slice(0, 200),
      });
    }
    const out: Record<string, string> = { 'content-type': contentType };
    for (const h of PASSED) if (resHeaders[h] !== undefined) out[h] = resHeaders[h];
    return { status: res.status, headers: out, body: text };
  }

  function verifyHook(headers: IncomingMessage['headers'], raw: string): Json {
    const h = (n: string): string | undefined => (typeof headers[n] === 'string' ? (headers[n] as string) : undefined);
    const ts = h('x-webhook-timestamp');
    const sig = h('x-webhook-signature');
    const now = Math.floor(Date.now() / 1000);
    const timestamp = ts && /^\d{1,12}$/.test(ts) ? Number(ts) : null;
    const expected = ts !== undefined ? signWebhook(env.PSP_API_SECRET, ts, raw) : null;
    const matched = ts !== undefined && sig ? secrets.findIndex((s) => safeEqual(signWebhook(s, ts, raw), sig)) : -1;
    const base = {
      timestamp,
      skewSeconds: timestamp === null ? null : now - timestamp,
      signatureValid: matched >= 0,
      expectedSignature: expected,
      bodyBytes: Buffer.byteLength(raw),
      signedWith: matched === 0 ? 'current' : matched === 1 ? 'previous' : null,
    };
    const result = (r: string, message: string): Json => ({ result: r, message, ...base });
    if (ts === undefined || sig === undefined)
      return result('missing_header', 'X-Webhook-Timestamp and X-Webhook-Signature are required');
    if (timestamp === null) return result('bad_timestamp', 'X-Webhook-Timestamp is not a number');
    if (Math.abs(now - timestamp) > 300)
      return result('timestamp_out_of_window', 'X-Webhook-Timestamp is outside ±300 s');
    if (!/^v1=[0-9a-f]{64}$/.test(sig)) return result('bad_signature_header', 'X-Webhook-Signature is malformed');
    if (matched < 0) return result('signature_mismatch', 'the signature does not match');
    const id = h('x-webhook-id');
    const type = h('x-webhook-event');
    if (!id || !type) return result('missing_header', 'X-Webhook-Id and X-Webhook-Event are required');
    let body: Json;
    try {
      body = JSON.parse(raw) as Json;
    } catch {
      return result('bad_body', 'the body is not JSON');
    }
    if (
      typeof body['id'] !== 'string' ||
      typeof body['type'] !== 'string' ||
      typeof body['chain'] !== 'string' ||
      typeof body['data'] !== 'object'
    ) {
      return result('bad_body', 'id, type, chain and data are required');
    }
    if (body['id'] !== id) return result('id_mismatch', 'the id of the body differs from X-Webhook-Id');
    if (body['type'] !== type) return result('type_mismatch', 'the type differs from X-Webhook-Event');
    if (body['version'] !== 1) return result('unsupported_version', 'version 1 only');
    if ((body['chain'] === 'mainnet') !== env.PSP_API_KEY.startsWith('psp_pk_live_'))
      return result('chain_mismatch', 'another network');
    return result('ok', 'verified');
  }

  async function receive(req: IncomingMessage, raw: string, res: ServerResponse): Promise<void> {
    const verify = verifyHook(req.headers, raw);
    const webhookId = typeof req.headers['x-webhook-id'] === 'string' ? req.headers['x-webhook-id'] : null;
    const ok = verify['result'] === 'ok';
    const duplicate = ok && webhookId !== null && accepted.has(webhookId);
    let status: number;
    let body: Json;
    if (receiver.failNext > 0) {
      receiver = { ...receiver, failNext: receiver.failNext - 1 };
      status = receiver.status;
      body = { forced: 'fail_next' };
    } else if (receiver.mode === 'fixed') {
      status = receiver.status;
      body = { forced: 'fixed' };
    } else if (ok) {
      status = 200;
      body = { received: true, duplicate };
    } else {
      const r = String(verify['result']);
      status = ['bad_body', 'id_mismatch', 'type_mismatch', 'unsupported_version'].includes(r) ? 400 : 401;
      body = { errorCode: r, errorMessage: String(verify['message']) };
    }
    if (ok && status >= 200 && status < 300 && webhookId) accepted.add(webhookId);
    let json: Json | null = null;
    try {
      json = JSON.parse(raw) as Json;
    } catch {
      json = null;
    }
    const invoice = ((json?.['data'] as Json | undefined)?.['invoice'] as Json | undefined) ?? {};
    const attempt = req.headers['x-webhook-attempt'];
    const { signedWith, ...verifyDetails } = verify;
    const entry: Json = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      webhookId,
      event: typeof req.headers['x-webhook-event'] === 'string' ? req.headers['x-webhook-event'] : null,
      attempt: typeof attempt === 'string' && /^\d+$/.test(attempt) ? Number(attempt) : null,
      invoiceId: typeof invoice['id'] === 'string' ? invoice['id'] : null,
      externalId: typeof invoice['externalId'] === 'string' ? invoice['externalId'] : null,
      invoiceStatus: typeof invoice['status'] === 'string' ? invoice['status'] : null,
      verifyResult: verify['result'],
      signedWith,
      duplicate,
      responseStatus: status,
      responseDelayMs: receiver.delayMs,
      remoteIp: req.socket.remoteAddress ?? null,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
      ),
      body: raw,
      json,
      verify: verifyDetails,
      responseBody: JSON.stringify(body),
    };
    webhooks.unshift(entry);
    const { remoteIp: _r, headers: _h, body: _b, json: _j, verify: _v, responseBody: _rb, ...item } = entry;
    emit('webhook', item);
    if (receiver.delayMs) await new Promise((r) => setTimeout(r, receiver.delayMs));
    send(res, status, body);
  }

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  function page(items: Json[], query: URLSearchParams): Json {
    const p = Number(query.get('page') ?? '1');
    const limit = Number(query.get('limit') ?? '50');
    if (!Number.isInteger(p) || p < 1) throw invalid('page', 'page must be ≥ 1');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalid('limit', 'limit must be 1–200');
    return { items: items.slice((p - 1) * limit, p * limit), page: p, limit, total: items.length };
  }

  function checkoutLink(invoiceId: string, raw: string): Json {
    if (!UUID_LOWER.test(invoiceId)) throw invalid('invoiceId', 'a lower-case uuid');
    const input = raw ? (JSON.parse(raw) as Json) : {};
    const expires = input['expiresInSeconds'] ?? 86_400;
    if (!Number.isInteger(expires) || (expires as number) < 1 || (expires as number) > 604_800)
      throw invalid('expiresInSeconds', '1–604800');
    const branding = (input['branding'] as Record<string, string> | undefined) ?? {};
    const unknown = Object.keys(branding).find(
      (k) => !['companyName', 'logoUrl', 'accentColor', 'theme', 'title'].includes(k),
    );
    if (unknown !== undefined) throw invalid(`branding.${unknown}`, 'not supported');
    if (branding['accentColor'] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(branding['accentColor']))
      throw invalid('branding.accentColor', '#rrggbb');
    if (branding['logoUrl'] !== undefined && !branding['logoUrl'].startsWith('https://'))
      throw invalid('branding.logoUrl', 'https');
    if (input['locale'] !== undefined && input['locale'] !== 'ru' && input['locale'] !== 'en')
      throw invalid('locale', 'ru or en');
    const payload: Json = { k: env.PSP_API_KEY, i: invoiceId, e: Math.floor(Date.now() / 1000) + (expires as number) };
    const b: Record<string, string> = {};
    for (const k of ['companyName', 'logoUrl', 'accentColor', 'theme', 'title'])
      if (branding[k] !== undefined) b[k] = branding[k];
    if (Object.keys(b).length) payload['b'] = b;
    if (input['locale']) payload['l'] = input['locale'];
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `v1.${encoded}.${signCheckoutPayload(env.PSP_API_SECRET, encoded)}`;
    return {
      url: `${env.PSP_CHECKOUT_URL}/#${token}`,
      token,
      expiresAt: new Date((payload['e'] as number) * 1000).toISOString(),
    };
  }

  async function handle(req: IncomingMessage, raw: string, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://backend');
    const method = req.method ?? 'GET';
    const path = url.pathname;
    const q = url.searchParams;
    if (method === 'POST' && path === '/webhooks/psp') return receive(req, raw, res);
    if (method === 'GET' && path === '/api/config') {
      return send(res, 200, {
        backend: 'plain',
        version: '0.0.0-reference',
        sdkVersion: null,
        net: env.PSP_API_KEY.startsWith('psp_pk_live_') ? 'mainnet' : 'testnet',
        apiUrl,
        keyId: env.PSP_API_KEY,
        previousSecretSet: Boolean(env.PSP_API_PREVIOUS_SECRET),
        checkoutUrl: env.PSP_CHECKOUT_URL,
        webhookUrl: env.APP_PUBLIC_URL ? `${env.APP_PUBLIC_URL}/webhooks/psp` : null,
        serverTime: new Date().toISOString(),
      });
    }
    if (path === '/api/stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      res.write(
        `retry: 3000\n\nevent: ready\ndata: ${JSON.stringify({ backend: 'plain', serverTime: new Date().toISOString() })}\n\n`,
      );
      streams.add(res);
      res.on('close', () => streams.delete(res));
      return;
    }
    if (path === '/api/request-log') {
      if (method === 'DELETE') {
        log.length = 0;
        res.writeHead(204).end();
        return;
      }
      const status = q.get('status');
      if (status !== null && !['2xx', '3xx', '4xx', '5xx', 'error'].includes(status))
        throw invalid('status', 'a status class');
      const items = log
        .filter((e) => !q.get('operationId') || e['operationId'] === q.get('operationId'))
        .filter((e) => !q.get('callId') || e['callId'] === q.get('callId'))
        .filter((e) => !q.get('source') || e['source'] === q.get('source'))
        .filter((e) => {
          if (!status) return true;
          if (status === 'error') return e['status'] === null;
          return e['status'] !== null && String(e['status'])[0] === status[0];
        })
        .map(itemOf);
      return send(res, 200, page(items, q));
    }
    const logId = /^\/api\/request-log\/([^/]+)$/.exec(path)?.[1];
    if (logId && method === 'GET') {
      const e = log.find((x) => x['id'] === logId);
      if (!e) throw new HttpError(404, 'example_not_found', 'No such entry');
      return send(res, 200, e);
    }
    if (path === '/api/received-webhooks') {
      if (method === 'DELETE') {
        webhooks.length = 0;
        accepted.clear();
        res.writeHead(204).end();
        return;
      }
      const items = webhooks
        .filter((w) => !q.get('webhookId') || w['webhookId'] === q.get('webhookId'))
        .filter((w) => !q.get('invoiceId') || w['invoiceId'] === q.get('invoiceId'))
        .filter((w) => !q.get('event') || w['event'] === q.get('event'))
        .filter((w) => !q.get('result') || (q.get('result') === 'ok') === (w['verifyResult'] === 'ok'))
        .map(({ remoteIp: _r, headers: _h, body: _b, json: _j, verify: _v, responseBody: _rb, ...item }) => item);
      return send(res, 200, page(items, q));
    }
    const hookId = /^\/api\/received-webhooks\/([^/]+)$/.exec(path)?.[1];
    if (hookId && method === 'GET') {
      const w = webhooks.find((x) => x['id'] === hookId);
      if (!w) throw new HttpError(404, 'example_not_found', 'No such webhook');
      return send(res, 200, w);
    }
    if (path === '/api/receiver') {
      if (method === 'GET') return send(res, 200, receiver);
      if (method === 'PUT') {
        const s = JSON.parse(raw || '{}') as Json;
        if (s['mode'] !== 'auto' && s['mode'] !== 'fixed') throw invalid('mode', 'auto or fixed');
        const ranges: [string, number, number][] = [
          ['status', 200, 599],
          ['delayMs', 0, 30_000],
          ['failNext', 0, 100],
        ];
        for (const [name, min, max] of ranges) {
          const v = s[name];
          if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw invalid(name, `${min}–${max}`);
        }
        receiver = {
          mode: s['mode'] as string,
          status: s['status'] as number,
          delayMs: s['delayMs'] as number,
          failNext: s['failNext'] as number,
        };
        return send(res, 200, receiver);
      }
    }
    const link = /^\/api\/invoices\/([^/]+)\/checkout-link$/.exec(path)?.[1];
    if (link && method === 'POST') return send(res, 200, checkoutLink(decodeURIComponent(link), raw));

    for (const route of passthrough) {
      const m = route.re.exec(path);
      if (!m || route.method !== method) continue;
      const callId = randomUUID();
      try {
        if (raw) {
          try {
            JSON.parse(raw);
          } catch {
            throw invalid('body', 'the body is not JSON');
          }
        }
        const clientRequestId = req.headers['x-client-request-id'];
        if (typeof clientRequestId === 'string' && !CLIENT_REQUEST_ID_RE.test(clientRequestId))
          throw invalid('X-Client-Request-Id', 'printable ASCII, 1–128');
        let merchantPath = route.path.replace(/^\/api\//, '/api/v1/');
        route.names.forEach((n, i) => (merchantPath = merchantPath.replace(`{${n}}`, m[i + 1] ?? '')));
        const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
        const out = await forward(route, merchantPath + query, req, raw, callId);
        res.writeHead(out.status, { ...out.headers, 'x-example-call-id': callId });
        res.end(out.body);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        send(
          res,
          err.status,
          { errorCode: err.errorCode, errorMessage: err.message, details: err.details },
          { 'x-example-call-id': callId },
        );
      }
      return;
    }
    throw new HttpError(404, 'example_not_found', `No route ${method} ${path}`);
  }

  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      handle(req, Buffer.concat(chunks).toString('utf8'), res).catch((err: unknown) => {
        if (err instanceof HttpError)
          send(res, err.status, { errorCode: err.errorCode, errorMessage: err.message, details: err.details });
        else send(res, 500, { errorCode: 'example_internal_error', errorMessage: String(err), details: null });
      });
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
