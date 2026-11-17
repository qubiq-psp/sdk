// The only way this UI talks to a backend: the routes of examples/contract (openapi.yaml), by operationId.
// Both backends (plain and sdk) serve the same contract, so this file works with either of them.
import type { operations } from '@psp-examples/contract/types';
import routes from '@psp-examples/contract/routes.json';

export type OpId = keyof operations;
type Op<O extends OpId> = operations[O];

/** Path parameters of an operation, e.g. `{ invoiceId }`. */
export type PathParams<O extends OpId> = Op<O>['parameters'] extends { path?: infer P } ? P : never;
/** Query parameters of an operation. Arrays are sent comma-separated, as the Merchant API expects. */
export type QueryParams<O extends OpId> = Op<O>['parameters'] extends { query?: infer Q } ? Q : never;
/** JSON request body of an operation. */
export type Body<O extends OpId> =
  Op<O> extends { requestBody?: infer B }
    ? B extends { content: { 'application/json': infer J } }
      ? J
      : never
    : never;

type SuccessCode = 200 | 201 | 202 | 204;
type JsonOf<R> = R extends { content: { 'application/json': infer J } } ? J : undefined;
type CsvOf<R> = R extends { content: { 'text/csv': infer T } } ? T : never;
/** The JSON body of a successful answer of an operation (any of its 2xx statuses). */
export type Ok<O extends OpId> = {
  [C in keyof Op<O>['responses']]: C extends SuccessCode ? JsonOf<Op<O>['responses'][C]> : never;
}[keyof Op<O>['responses']];
/** The `text/csv` body of a successful answer, as the contract declares it (`string`); `never` without one. */
export type CsvOk<O extends OpId> = {
  [C in keyof Op<O>['responses']]: C extends SuccessCode ? CsvOf<Op<O>['responses'][C]> : never;
}[keyof Op<O>['responses']];
/** The operations with a `text/csv` success answer: the statement with `format=csv`. */
export type CsvOpId = { [O in OpId]: [CsvOk<O>] extends [never] ? never : O }[OpId];

/** How a call was made, for the screens and for the link to its request-log entries. */
export interface CallMeta {
  operationId: OpId;
  method: string;
  /** The contract URL that was called, with the query. */
  url: string;
  /** HTTP status; 0 — the backend did not answer at all. */
  status: number;
  /** `X-Example-Call-Id`: the request-log entries of this call have it as `callId`. */
  callId: string | null;
  /** `X-Request-Id` of the platform, passed through. */
  requestId: string | null;
  /** `X-Client-Request-Id` echoed by the platform. */
  clientRequestId: string | null;
  /** `X-Api-Key-Deprecated`: the key is the previous one and works until this time. */
  apiKeyDeprecated: string | null;
  /** `Retry-After` on `429` and `503`. */
  retryAfter: string | null;
  source: Source;
  startedAt: string;
  durationMs: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: CallMeta;
}

/** Who produced the error: the platform, the example backend (`example_*`), or nobody (no answer). */
export type ErrorOrigin = 'platform' | 'backend' | 'network';

/**
 * A failed call: a platform error passed through unchanged (`{ errorCode, errorMessage, details }`), an error of the
 * example backend (`example_*` codes, same shape), or no answer at all.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly details: unknown;
  readonly origin: ErrorOrigin;
  readonly meta: CallMeta;
  /** The raw body when it was not the error shape. */
  readonly bodyText: string | null;

  constructor(
    meta: CallMeta,
    body: unknown,
    bodyText: string | null,
    options: { network?: string; origin?: ErrorOrigin } = {},
  ) {
    const networkMessage = options.network;
    const shaped = errorShape(body);
    const errorCode = networkMessage
      ? 'network_error'
      : (shaped?.errorCode ?? (meta.status ? `http_${meta.status}` : 'network_error'));
    const errorMessage =
      networkMessage ?? shaped?.errorMessage ?? (bodyText ? bodyText.slice(0, 300) : `HTTP ${meta.status}`);
    super(`${errorCode}: ${errorMessage}`);
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    this.details = shaped ? shaped.details : null;
    this.origin =
      options.origin ??
      (networkMessage ? 'network' : errorCode.startsWith('example_') || !shaped ? 'backend' : 'platform');
    this.meta = meta;
    this.bodyText = shaped ? null : bodyText;
  }
}

function errorShape(body: unknown): { errorCode: string; errorMessage: string; details: unknown } | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b['errorCode'] !== 'string') return null;
  return {
    errorCode: b['errorCode'],
    errorMessage: typeof b['errorMessage'] === 'string' ? b['errorMessage'] : '',
    details: b['details'] ?? null,
  };
}

/** `ui` — the user asked for it; `poll` — the UI did it by itself (auto-refresh, live updates). */
export type Source = 'ui' | 'poll';

export interface CallOptions<O extends OpId> {
  path?: PathParams<O>;
  query?: QueryParams<O>;
  body?: Body<O>;
  /** Sent as `X-Example-Source`; passthrough routes only. Default `ui`. */
  source?: Source;
  /** Sent as `X-Client-Request-Id`; passthrough routes only. */
  clientRequestId?: string;
  signal?: AbortSignal;
}

interface Route {
  operationId: string;
  method: string;
  path: string;
  merchantApi: string | null;
  sdkMethod: string | null;
  extra: boolean;
}

const ROUTES: ReadonlyMap<string, Route> = new Map((routes as Route[]).map((r) => [r.operationId, r]));

/** The contract route of an operation. */
export function routeOf(operationId: OpId): Route {
  const route = ROUTES.get(operationId);
  if (!route) throw new Error(`No contract route for ${operationId}`);
  return route;
}

/** Every route of the contract, in its order. */
export const allRoutes = (): readonly Route[] => [...ROUTES.values()];

/**
 * The query string as the Merchant API signs and reads it: arrays joined with `,`, commas left as they are, empty
 * values left out (the request-signing rules).
 */
export function queryString(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Array.isArray(raw) ? raw.map(String).join(',') : String(raw as string | number | boolean);
    if (value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** The contract path with the ids filled in, each percent-encoded as one segment. */
export function buildPath(template: string, params: unknown): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = (params as Record<string, unknown> | undefined)?.[name];
    if (value === undefined || value === null || value === '') throw new Error(`Missing path parameter ${name}`);
    return encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
  });
}

/** The full contract URL of a call: what goes to `fetch`. */
export function urlOf<O extends OpId>(operationId: O, options: Pick<CallOptions<O>, 'path' | 'query'> = {}): string {
  const route = routeOf(operationId);
  return buildPath(route.path, options.path) + queryString(options.query);
}

/**
 * Calls one contract route. Resolves with the parsed body and how the call went; rejects with {@link ApiError} on any
 * non-2xx answer or when there is no answer. Platform errors arrive exactly as the platform sent them.
 */
export function call<O extends OpId>(operationId: O, options: CallOptions<O> = {}): Promise<ApiResponse<Ok<O>>> {
  return send(operationId, options, 'json') as Promise<ApiResponse<Ok<O>>>;
}

/**
 * Calls a route for its `text/csv` body: the CSV statement (`format=csv`). Only operations whose contract declares a
 * `text/csv` answer are accepted, and the result has the contract's type of that answer (`string`).
 */
export function callText<O extends CsvOpId>(
  operationId: O,
  options: CallOptions<O> = {},
): Promise<ApiResponse<CsvOk<O>>> {
  return send(operationId, options, 'text') as Promise<ApiResponse<CsvOk<O>>>;
}

/** One call: `json` parses the success body (and refuses a body that is not JSON), `text` keeps it as text. */
async function send<O extends OpId>(
  operationId: O,
  options: CallOptions<O>,
  as: 'json' | 'text',
): Promise<ApiResponse<unknown>> {
  const route = routeOf(operationId);
  const url = urlOf(operationId, options);
  const source = options.source ?? 'ui';
  const headers: Record<string, string> = { accept: as === 'text' ? 'text/csv, */*' : 'application/json' };
  // Only the passthrough routes know these headers; the example routes would ignore them
  if (!route.extra) {
    headers['X-Example-Source'] = source;
    if (options.clientRequestId) headers['X-Client-Request-Id'] = options.clientRequestId;
  }
  // No body — no Content-Type: an empty body with application/json is a bad request
  const body: unknown = options.body;
  const hasBody = body !== undefined;
  if (hasBody) headers['content-type'] = 'application/json';

  const startedAt = new Date();
  const meta: CallMeta = {
    operationId,
    method: route.method,
    url,
    status: 0,
    callId: null,
    requestId: null,
    clientRequestId: null,
    apiKeyDeprecated: null,
    retryAfter: null,
    source,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: route.method,
      headers,
      credentials: 'same-origin',
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    meta.durationMs = Date.now() - startedAt.getTime();
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(meta, null, null, { network: `The backend did not answer: ${reason}` });
  }

  meta.status = res.status;
  meta.callId = res.headers.get('X-Example-Call-Id');
  meta.requestId = res.headers.get('X-Request-Id');
  meta.clientRequestId = res.headers.get('X-Client-Request-Id');
  meta.apiKeyDeprecated = res.headers.get('X-Api-Key-Deprecated');
  meta.retryAfter = res.headers.get('Retry-After');

  const text = await res.text();
  meta.durationMs = Date.now() - startedAt.getTime();
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  let json: unknown = undefined;
  if (text && (isJson || as !== 'text')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) throw new ApiError(meta, json, text || null);
  if (as === 'text') return { data: text, meta };
  if (text && json === undefined) {
    const body = { errorCode: 'ui_bad_response', errorMessage: 'A 2xx answer that is not JSON', details: null };
    throw new ApiError(meta, body, text, { origin: 'backend' });
  }
  return { data: json, meta };
}

/** The message of any error, for toasts. */
export const errorText = (err: unknown): string =>
  err instanceof ApiError ? `${err.errorCode}: ${err.errorMessage}` : err instanceof Error ? err.message : String(err);
