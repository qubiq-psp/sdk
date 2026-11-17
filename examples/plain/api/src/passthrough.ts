// The passthrough routes: `/api/<path>` of the contract → `/api/v1/<path>` of the Merchant API, one route per Merchant
// API operation (examples/contract/README.md, "Passthrough rules"). The backend forwards, it does not validate: the
// query string and the JSON body go out byte for byte, and the platform's status, body and headers come back
// unchanged, so the UI sees the platform's own validation errors. One signed attempt per call, no retries.
import { randomUUID } from 'node:crypto';
import routes from '@psp-examples/contract/routes.json' with { type: 'json' };
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { ExampleHttpError, invalidRequest } from './errors.ts';
import { callPlatform, type PlatformAttempt } from './platform.ts';
import { toEntry, type RequestLog } from './request-log.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface PassthroughRoute {
  operationId: string;
  method: Method;
  /** Contract path, e.g. `/api/invoices/{invoiceId}`. */
  path: string;
}

/** The 27 passthrough routes of the contract. */
export const PASSTHROUGH_ROUTES: PassthroughRoute[] = routes
  .filter((r) => !r.extra)
  .map((r) => ({ operationId: r.operationId, method: r.method as Method, path: r.path }));

/** Per-attempt timeouts. The platform answers any request within 180 s (gateway docs 13.10). */
export interface Timeouts {
  /** `createPayout`: 180 s — a shorter one turns a payout still being made into an unknown outcome. */
  createPayout: number;
  /** Every other operation. */
  other: number;
}
export const DEFAULT_TIMEOUTS: Timeouts = { createPayout: 180_000, other: 60_000 };

/** Headers of the platform's answer that reach the UI (besides `Content-Type`). */
const PASSED_HEADERS = ['X-Request-Id', 'X-Client-Request-Id', 'X-Api-Key-Deprecated', 'Retry-After'];
const CLIENT_REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;
const PREVIEW_CHARS = 500;
/** Request bodies up to 1 MB reach the platform, which itself refuses more than 64 KB (`413 payload_too_large`). */
const BODY_LIMIT = 1024 * 1024;

export interface PassthroughDeps {
  config: Config;
  log: RequestLog;
  timeouts: Timeouts;
  fetch: typeof fetch;
}

const callIds = new WeakMap<FastifyRequest, string>();

export async function registerPassthrough(app: FastifyInstance, deps: PassthroughDeps): Promise<void> {
  await app.register(async (scope) => {
    // Bodies stay raw bytes in this scope: they are forwarded and signed exactly as received
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });
    // Every passthrough answer carries the id of the call — also a backend-own error before the platform call
    scope.addHook('onRequest', async (req, reply) => {
      const callId = randomUUID();
      callIds.set(req, callId);
      void reply.header('X-Example-Call-Id', callId);
    });

    for (const route of PASSTHROUGH_ROUTES) {
      scope.route({
        method: route.method,
        url: route.path.replace(/\{(\w+)\}/g, ':$1'),
        handler: async (req, reply) => passthrough(route, req, reply, deps),
      });
    }
  });
}

async function passthrough(
  route: PassthroughRoute,
  req: FastifyRequest,
  reply: FastifyReply,
  { config, log, timeouts, fetch: fetchImpl }: PassthroughDeps,
): Promise<FastifyReply> {
  const callId = callIds.get(req) ?? randomUUID();

  // The only checks before the platform call — the same ones the SDK makes before sending
  const params = req.params as Record<string, string>;
  const merchantPath = route.path.replace(/^\/api\//, '/api/v1/').replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name] ?? '';
    // `.` and `..` would change the path: WHATWG URL resolves them, even percent-encoded
    if (value === '' || value === '.' || value === '..') throw invalidRequest(name, 'must not be empty, "." or ".."');
    return encodeURIComponent(value);
  });
  const rawClientRequestId = req.headers['x-client-request-id'];
  if (rawClientRequestId !== undefined && !CLIENT_REQUEST_ID_RE.test(String(rawClientRequestId))) {
    throw invalidRequest('X-Client-Request-Id', 'must be 1–128 printable ASCII characters without spaces');
  }
  const clientRequestId = rawClientRequestId === undefined ? null : String(rawClientRequestId);
  const body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
  if (body) {
    try {
      JSON.parse(body.toString('utf8'));
    } catch {
      throw invalidRequest('body', 'must be JSON');
    }
  }
  // The query string exactly as received: it is part of what gets signed
  const rawUrl = req.raw.url ?? '';
  const queryAt = rawUrl.indexOf('?');
  const query = queryAt === -1 ? '' : rawUrl.slice(queryAt);

  const timeoutMs = route.operationId === 'createPayout' ? timeouts.createPayout : timeouts.other;
  const attempt = await callPlatform(
    { apiUrl: config.apiUrl, apiKey: config.apiKey, apiSecret: config.apiSecret },
    {
      method: route.method,
      target: `${merchantPath}${query}`,
      body,
      clientRequestId,
      timeoutMs,
    },
    fetchImpl,
  );
  log.add(
    toEntry(
      {
        id: randomUUID(),
        callId,
        // X-Example-Source only tags the entry; it is not forwarded
        source: req.headers['x-example-source'] === 'poll' ? 'poll' : 'ui',
        operationId: route.operationId,
        method: route.method,
        requestBody: body,
        clientRequestId,
      },
      attempt,
    ),
  );
  return answer(route, attempt, timeoutMs, reply);
}

/** The platform's answer, unchanged — or an `example_*` error when there is no usable answer. */
function answer(
  route: PassthroughRoute,
  attempt: PlatformAttempt,
  timeoutMs: number,
  reply: FastifyReply,
): FastifyReply {
  const res = attempt.response;
  if (!res) {
    const error = attempt.transportError;
    if (error?.code === 'timeout') {
      throw new ExampleHttpError(504, 'example_upstream_timeout', `The platform did not answer in ${timeoutMs} ms`, {
        timeoutMs,
      });
    }
    const cause = error?.message ?? 'connection failed';
    throw new ExampleHttpError(502, 'example_upstream_unreachable', `The platform is unreachable: ${cause}`, { cause });
  }

  const text = res.body.toString('utf8');
  const contentType = res.headers['content-type'] ?? '';
  const badResponse = (why: string) =>
    new ExampleHttpError(502, 'example_upstream_bad_response', `Not an answer of the platform: ${why}`, {
      status: res.status,
      requestId: res.headers['x-request-id'] ?? null,
      bodyPreview: text.slice(0, PREVIEW_CHARS),
    });
  const json = (): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };

  if (res.status < 200 || (res.status >= 300 && res.status < 400)) {
    throw badResponse(`HTTP ${res.status}${res.headers['location'] ? ' (a redirect)' : ''}`);
  }
  if (res.status < 300) {
    if (res.body.length === 0) throw badResponse(`HTTP ${res.status} with an empty body`);
    const csv = route.operationId === 'getMerchantOperationsStatement' && /^text\/csv\b/i.test(contentType);
    if (!csv && json() === undefined) throw badResponse(`HTTP ${res.status} with a body that is not JSON`);
  } else {
    const error = json() as { errorCode?: unknown } | null | undefined;
    if (typeof error?.errorCode !== 'string') throw badResponse(`HTTP ${res.status} without a platform error body`);
  }

  for (const name of PASSED_HEADERS) {
    const value = res.headers[name.toLowerCase()];
    if (value !== undefined) void reply.header(name, value);
  }
  void reply.header('Content-Type', contentType || 'application/json; charset=utf-8');
  return reply.status(res.status).send(res.body);
}
