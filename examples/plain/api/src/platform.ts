// One signed attempt to the PSP Merchant API with the global `fetch` of Node.js: sign the exact TARGET and body bytes
// (signer.ts), send them, read the answer. No retries here — see "Retries" in the README for what a production client
// adds (the platform's retry rules). Everything about the attempt is returned for the request log; the
// secret is used only as the HMAC key and appears nowhere in the result.
import { resolveTarget, signRequest } from './signer.ts';
import { VERSION } from './version.ts';

export const USER_AGENT = `psp-examples-plain-api/${VERSION} (node/${process.versions.node})`;

export interface PlatformCredentials {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

export interface PlatformRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** `/api/v1/…` and the query as received. */
  target: string;
  /** The JSON body bytes to send as they are; `null` — no body. */
  body: Buffer | null;
  /** Your own request id, echoed by the platform and shown in the cabinet's activity log. Not signed. */
  clientRequestId: string | null;
  timeoutMs: number;
}

export interface PlatformAttempt {
  url: string;
  /** Path and query as signed and sent. */
  target: string;
  requestHeaders: Record<string, string>;
  signing: { stringToSign: string; bodySha256: string };
  startedAt: Date;
  durationMs: number;
  /** `null` — no answer: see `transportError`. */
  response: { status: number; headers: Record<string, string>; body: Buffer } | null;
  transportError: { code: 'timeout' | 'network'; message: string } | null;
}

/** Signs and sends one attempt. Never throws for a network problem: it is reported in `transportError`. */
export async function callPlatform(
  credentials: PlatformCredentials,
  request: PlatformRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformAttempt> {
  // Build the URL once and sign what `fetch` will put into the request line
  const { url, target } = resolveTarget(credentials.apiUrl, request.target);
  const signed = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    method: request.method,
    target,
    body: request.body,
  });
  const csv = url.searchParams.get('format') === 'csv';
  const headers: Record<string, string> = {
    Accept: csv ? 'text/csv, application/json' : 'application/json',
    'User-Agent': USER_AGENT,
    ...signed.headers,
  };
  if (request.body) headers['Content-Type'] = 'application/json';
  if (request.clientRequestId !== null) headers['X-Client-Request-Id'] = request.clientRequestId;

  const startedAt = new Date();
  const started = performance.now();
  const base = { url: url.href, target, requestHeaders: headers, signing: signed, startedAt };
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await fetchImpl(url, {
      method: request.method,
      headers,
      ...(request.body ? { body: request.body } : {}),
      // A redirect is not the platform's answer: it is reported, not followed (the signature is for this URL only)
      redirect: 'manual',
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const body = Buffer.from(await res.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    return {
      ...base,
      durationMs: elapsed(),
      response: { status: res.status, headers: responseHeaders, body },
      transportError: null,
    };
  } catch (err) {
    const e = err as Error & { cause?: { code?: unknown; message?: unknown } };
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    const cause = [e.message, e.cause?.code, e.cause?.message].filter((part) => typeof part === 'string' && part);
    return {
      ...base,
      durationMs: elapsed(),
      response: null,
      transportError: timeout
        ? { code: 'timeout', message: `no answer in ${request.timeoutMs} ms` }
        : { code: 'network', message: [...new Set(cause)].join(': ') || 'connection failed' },
    };
  }
}
