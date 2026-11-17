// The request log: one entry per attempt sent to the platform (examples/contract/README.md, "Request log"), in
// memory, at most APP_LOG_LIMIT entries. Entries hold the signature headers and the string to sign, never the secret.
import type { FastifyInstance } from 'fastify';
import type { EventBus } from './bus.ts';
import { invalidRequest, notFound } from './errors.ts';
import { MemoryLog } from './memory-log.ts';
import type { PlatformAttempt } from './platform.ts';
import type { RequestLogEntry, RequestLogItem, RequestLogPage } from './types.ts';

/** Response bodies are kept up to 256 KB: a CSV statement can be large. */
export const RESPONSE_BODY_MAX_BYTES = 256 * 1024;

const ITEM_KEYS = [
  'id',
  'callId',
  'createdAt',
  'source',
  'operationId',
  'sdkMethod',
  'attempt',
  'method',
  'path',
  'status',
  'errorCode',
  'requestId',
  'clientRequestId',
  'apiKeyDeprecatedUntil',
  'durationMs',
  'transportError',
] as const satisfies readonly (keyof RequestLogItem)[];

/** The list form of an entry (also the data of the SSE event `request`). */
export function toItem(entry: RequestLogEntry): RequestLogItem {
  return Object.fromEntries(ITEM_KEYS.map((key) => [key, entry[key]])) as RequestLogItem;
}

/** `errorCode` of a non-2xx JSON answer. */
function errorCodeOf(status: number, body: Buffer): string | null {
  if (status < 400) return null;
  try {
    const json = JSON.parse(body.toString('utf8')) as { errorCode?: unknown } | null;
    return typeof json?.errorCode === 'string' ? json.errorCode : null;
  } catch {
    return null;
  }
}

export interface AttemptContext {
  id: string;
  callId: string;
  source: 'ui' | 'poll';
  operationId: string;
  method: RequestLogItem['method'];
  requestBody: Buffer | null;
  clientRequestId: string | null;
}

/** Turns a finished attempt into a log entry. */
export function toEntry(ctx: AttemptContext, attempt: PlatformAttempt): RequestLogEntry {
  const res = attempt.response;
  return {
    id: ctx.id,
    callId: ctx.callId,
    createdAt: attempt.startedAt.toISOString(),
    source: ctx.source,
    operationId: ctx.operationId,
    // plain calls no SDK method; one attempt per call
    sdkMethod: null,
    attempt: 1,
    method: ctx.method,
    path: attempt.target,
    status: res?.status ?? null,
    errorCode: res ? errorCodeOf(res.status, res.body) : null,
    requestId: res?.headers['x-request-id'] ?? null,
    clientRequestId: ctx.clientRequestId,
    apiKeyDeprecatedUntil: res?.headers['x-api-key-deprecated'] ?? null,
    durationMs: attempt.durationMs,
    transportError: attempt.transportError,
    url: attempt.url,
    requestHeaders: attempt.requestHeaders,
    requestBody: ctx.requestBody ? ctx.requestBody.toString('utf8') : null,
    responseHeaders: res ? res.headers : null,
    responseBody: res ? res.body.subarray(0, RESPONSE_BODY_MAX_BYTES).toString('utf8') : null,
    responseBodyTruncated: res ? res.body.length > RESPONSE_BODY_MAX_BYTES : false,
    signing: { stringToSign: attempt.signing.stringToSign, bodySha256: attempt.signing.bodySha256 },
  };
}

export class RequestLog {
  readonly #entries: MemoryLog<RequestLogEntry>;
  readonly #bus: EventBus;

  constructor(limit: number, bus: EventBus) {
    this.#entries = new MemoryLog(limit);
    this.#bus = bus;
  }

  /** Stores the entry and sends it to the SSE stream. */
  add(entry: RequestLogEntry): void {
    this.#entries.add(entry);
    this.#bus.emit({ type: 'request', item: toItem(entry) });
  }

  get(id: string): RequestLogEntry | undefined {
    return this.#entries.get(id);
  }

  page(filter: (entry: RequestLogEntry) => boolean, page: number, limit: number) {
    return this.#entries.page(filter, page, limit);
  }

  clear(): void {
    this.#entries.clear();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `page` and `limit` of the list routes: 1+, and 1–200 (default 50). */
export function pageParams(query: Record<string, string | undefined>): { page: number; limit: number } {
  const int = (name: 'page' | 'limit', fallback: number, max: number): number => {
    const raw = query[name];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!/^[0-9]+$/.test(raw) || n < 1 || n > max) throw invalidRequest(name, `must be an integer from 1 to ${max}`);
    return n;
  };
  return { page: int('page', 1, Number.MAX_SAFE_INTEGER), limit: int('limit', 50, 200) };
}

/** A query of single values: a repeated parameter is refused. */
export function singleQuery(query: unknown): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(query as Record<string, unknown>)) {
    if (typeof value !== 'string') throw invalidRequest(name, 'must be given once');
    out[name] = value;
  }
  return out;
}

export function registerRequestLogRoutes(app: FastifyInstance, { log }: { log: RequestLog }): void {
  app.get('/api/request-log', async (req): Promise<RequestLogPage> => {
    const q = singleQuery(req.query);
    const { page, limit } = pageParams(q);
    const { source, operationId, callId, status } = q;
    if (source !== undefined && source !== 'ui' && source !== 'poll')
      throw invalidRequest('source', 'must be ui or poll');
    if (callId !== undefined && !UUID_RE.test(callId)) throw invalidRequest('callId', 'must be a uuid');
    if (status !== undefined && !['2xx', '3xx', '4xx', '5xx', 'error'].includes(status)) {
      throw invalidRequest('status', 'must be 2xx, 3xx, 4xx, 5xx or error');
    }
    const statusMatches = (s: number | null): boolean => {
      if (status === undefined) return true;
      if (status === 'error') return s === null;
      return s !== null && Math.floor(s / 100) === Number(status[0]);
    };
    const result = log.page(
      (e) =>
        (source === undefined || e.source === source) &&
        (operationId === undefined || e.operationId === operationId) &&
        (callId === undefined || e.callId === callId.toLowerCase()) &&
        statusMatches(e.status),
      page,
      limit,
    );
    return { items: result.items.map(toItem), page, limit, total: result.total };
  });

  app.get('/api/request-log/:entryId', async (req): Promise<RequestLogEntry> => {
    const { entryId } = req.params as { entryId: string };
    const entry = log.get(entryId);
    if (!entry) throw notFound('No such request-log entry (the log keeps the latest entries, in memory)');
    return entry;
  });

  app.delete('/api/request-log', async (_req, reply) => {
    log.clear();
    return reply.status(204).send();
  });
}
