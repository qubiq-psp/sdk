// Example plumbing: the request log — one entry per HTTP attempt the SDK makes, filled by a `fetch` wrapper.
//
// The SDK takes a `fetch` option (PspClientOptions.fetch). We give it a wrapper of the global fetch that sees every
// attempt exactly as sent — the URL, the signature headers, the body bytes — and the answer, and writes one entry when
// the attempt ends. Retries of the SDK (its default policy) are separate attempts, so one contract
// call may produce several entries: `attempt` 1, 2, …, all with the same `callId`. `onResponse` of the SDK would give
// the status and X-Request-Id only, not the headers or the bodies.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PspAuthError, type PspRetryInfo } from '@qubiq-psp/sdk';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { BoundedLog } from '../bounded-log';
import { callContext, type ApiCall } from '../call-context';
import { ExampleError, pageParams, stringParam, uuidParam } from '../example-error';
import type { RequestLogEntry, RequestLogItem, RequestLogPage } from './request-log.types';

/** Response bodies are kept up to 256 KB (a CSV statement can be large)… */
const MAX_BODY_BYTES = 256 * 1024;
/** …request bodies up to 64 KB, the platform's own limit (a `/api` body may be up to 1 MB). */
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'error'] as const;

@Injectable()
export class RequestLogService {
  readonly #log: BoundedLog<RequestLogEntry>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.#log = new BoundedLog(config.logLimit, config.logMaxBytes);
  }

  /**
   * The `fetch` for the SDK: calls `baseFetch` and records the attempt in the log of the current call. Outside a
   * contract call (no call context) it only forwards.
   */
  recordingFetch(baseFetch: typeof fetch): typeof fetch {
    return async (input, init) => {
      const call = callContext.current();
      if (!call) return baseFetch(input, init);

      const attempt = call.attempts.size + 1;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const requestHeaders = sentHeaders(init?.headers);
      const createdAt = new Date();
      const started = performance.now();
      const entry: RequestLogEntry = {
        id: randomUUID(),
        callId: call.callId,
        createdAt: createdAt.toISOString(),
        source: call.source,
        operationId: call.operationId,
        sdkMethod: call.sdkMethod,
        attempt,
        method: (init?.method ?? 'GET').toUpperCase() as RequestLogEntry['method'],
        path: `${url.pathname}${url.search}`,
        status: null,
        errorCode: null,
        requestId: null,
        clientRequestId: new Headers(init?.headers).get('x-client-request-id'),
        apiKeyDeprecatedUntil: null,
        durationMs: 0,
        transportError: null,
        url: url.href,
        requestHeaders,
        ...requestBodyOf(init?.body),
        responseHeaders: null,
        responseBody: null,
        responseBodyTruncated: false,
        signing: null,
      };
      call.attempts.set(attempt, entry);

      try {
        const response = await baseFetch(input, init);
        // The SDK reads the original body; we read a copy. Awaiting it here keeps the attempt open until the body
        // arrived, as the SDK's timeout does.
        const text = await response.clone().text();
        entry.status = response.status;
        entry.requestId = response.headers.get('x-request-id');
        entry.apiKeyDeprecatedUntil = response.headers.get('x-api-key-deprecated');
        entry.responseHeaders = plainHeaders(response.headers);
        entry.errorCode = response.ok ? null : errorCodeOf(text);
        const bytes = Buffer.from(text, 'utf8');
        entry.responseBodyTruncated = bytes.length > MAX_BODY_BYTES;
        entry.responseBody = entry.responseBodyTruncated ? bytes.subarray(0, MAX_BODY_BYTES).toString('utf8') : text;
        call.lastResponse = { status: response.status, headers: response.headers };
        return response;
      } catch (err) {
        // The SDK aborts an attempt with the reason `new Error('timeout')` when its timeout runs out
        const timedOut =
          init?.signal?.aborted === true && (init.signal.reason as Error | undefined)?.message === 'timeout';
        entry.transportError = timedOut
          ? { code: 'timeout', message: 'No answer within the timeout of the attempt' }
          : { code: 'network', message: describe(err) };
        throw err;
      } finally {
        entry.durationMs = Math.round(performance.now() - started);
        this.#log.add(entry);
      }
    };
  }

  /**
   * `onRetry` of the SDK: an attempt refused with `401 api_auth_failed` is retried once at `timestamp_out_of_window`;
   * its entry gets the string the SDK signed.
   */
  noteRetry(info: PspRetryInfo): void {
    const call = callContext.current();
    if (call) this.noteAuthError(call, info.error, info.attempt);
  }

  /** At `401 api_auth_failed` the SDK's `PspAuthError.localStringToSign` fills `signing` of that attempt's entry. */
  noteAuthError(call: ApiCall, error: unknown, attempt = (error as PspAuthError).context?.attempts): void {
    if (!(error instanceof PspAuthError) || attempt === undefined) return;
    const entry = call.attempts.get(attempt);
    if (!entry) return;
    entry.signing = {
      stringToSign: error.localStringToSign,
      // The sixth line of the string to sign (the request-signing rules)
      bodySha256: error.localStringToSign.split('\n')[5] ?? null,
    };
  }

  list(query: Readonly<Record<string, unknown>>): RequestLogPage {
    const { page, limit } = pageParams(query);
    const source = stringParam(query, 'source', ['ui', 'poll'] as const);
    const operationId = stringParam(query, 'operationId');
    const callId = uuidParam(query, 'callId');
    const status = stringParam(query, 'status', STATUS_CLASSES);
    const result = this.#log.page(
      (entry) =>
        (source === undefined || entry.source === source) &&
        (operationId === undefined || entry.operationId === operationId) &&
        (callId === undefined || entry.callId === callId) &&
        (status === undefined || statusClass(entry.status) === status),
      page,
      limit,
    );
    return { items: result.items.map(toItem), page, limit, total: result.total };
  }

  get(id: string): RequestLogEntry {
    const entry = this.#log.get(id);
    if (!entry) throw ExampleError.notFound('No such request-log entry (a restart clears the log)');
    return entry;
  }

  clear(): void {
    this.#log.clear();
  }

  /** New entries as `RequestLogItem`, for the SSE stream. */
  subscribe(listener: (item: RequestLogItem) => void): () => void {
    return this.#log.subscribe((entry) => {
      listener(toItem(entry));
    });
  }
}

/** The list form of an entry: without headers, bodies and signing. */
function toItem(entry: RequestLogEntry): RequestLogItem {
  const {
    url: _url,
    requestHeaders: _requestHeaders,
    requestBody: _requestBody,
    requestBodyTruncated: _requestBodyTruncated,
    responseHeaders: _responseHeaders,
    responseBody: _responseBody,
    responseBodyTruncated: _responseBodyTruncated,
    signing: _signing,
    ...item
  } = entry;
  return item;
}

/** The body the SDK sent (always a JSON string), cut to {@link MAX_REQUEST_BODY_BYTES}. */
function requestBodyOf(body: RequestInit['body']): Pick<RequestLogEntry, 'requestBody' | 'requestBodyTruncated'> {
  if (typeof body !== 'string') return { requestBody: null, requestBodyTruncated: false };
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= MAX_REQUEST_BODY_BYTES) return { requestBody: body, requestBodyTruncated: false };
  return { requestBody: bytes.subarray(0, MAX_REQUEST_BODY_BYTES).toString('utf8'), requestBodyTruncated: true };
}

function statusClass(status: number | null): string {
  return status === null ? 'error' : `${String(status).charAt(0)}xx`;
}

/** Response headers, names in lower case. */
function plainHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

/** Request headers with the names as the SDK wrote them (`X-Api-Signature`, …). */
function sentHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (headers === undefined) return {};
  if (headers instanceof Headers || Array.isArray(headers)) return plainHeaders(new Headers(headers));
  return { ...(headers as Record<string, string>) };
}

function errorCodeOf(text: string): string | null {
  try {
    const body = JSON.parse(text) as { errorCode?: unknown } | null;
    return typeof body?.errorCode === 'string' ? body.errorCode : null;
  } catch {
    return null;
  }
}

function describe(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    parts.push(typeof code === 'string' ? `${current.message} (${code})` : current.message);
    current = current.cause;
  }
  return parts.join(': ') || 'The request failed';
}
