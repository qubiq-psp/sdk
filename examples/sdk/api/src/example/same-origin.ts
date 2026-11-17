// Example plumbing: cross-site request refusal for /api/* (examples/contract/README.md, «Same origin»). The only login
// is nginx basic auth, which a browser attaches to any request to the deployment, also one a page of another site
// makes. So, before any body parser and platform call:
//   1. a state-changing request (POST, PUT, DELETE, PATCH) is refused with 403 example_forbidden when the browser
//      says it comes from another site: `Sec-Fetch-Site` other than `same-origin`/`none`, or an `Origin` whose host
//      differs from `Host`. A request without these headers (curl, a script) passes: it carries no browser
//      credentials of a victim;
//   2. a body must be `Content-Type: application/json` (else 400 example_invalid_request, field `Content-Type`): a
//      cross-site page can send JSON only after a CORS preflight, which this backend never answers.
// `Host` is the host the browser used: nginx passes it on (`proxy_set_header Host $host`) and accepts no other host.
// `X-Forwarded-Host` is not used. The scheme is not compared: TLS ends at nginx, which redirects http to https.
// A shop's own backend gets the same from a CSRF token or SameSite session cookies; here there is no session.
import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { ExampleError } from './example-error';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const SAME_SITE_FETCH = new Set(['same-origin', 'none']);

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** `Origin` names the same host (and port) as `Host`. */
function sameHost(origin: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    // `null` (a sandboxed frame, a file) or garbage
    return false;
  }
}

const forbidden = (header: string, value: string): ExampleError =>
  new ExampleError('example_forbidden', `A cross-site request is refused (${header}: ${value})`, { header, value });

/** The error to answer an `/api/*` request with, or `null` when it may go on. */
export function refusalOf(method: string, headers: IncomingHttpHeaders): ExampleError | null {
  if (STATE_CHANGING.has(method.toUpperCase())) {
    const site = one(headers['sec-fetch-site']);
    if (site !== undefined && !SAME_SITE_FETCH.has(site)) return forbidden('Sec-Fetch-Site', site);
    const origin = one(headers.origin);
    if (origin !== undefined && !sameHost(origin, one(headers.host))) return forbidden('Origin', origin);
  }
  const length = one(headers['content-length']);
  const hasBody = (length !== undefined && length !== '0') || headers['transfer-encoding'] !== undefined;
  if (hasBody) {
    const mediaType = (one(headers['content-type']) ?? '').split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') return ExampleError.invalid('Content-Type', 'must be application/json');
  }
  return null;
}

/** Express middleware on `/api`, after the call id and before the body parser. */
export function refuseCrossSite(req: Request, res: Response, next: NextFunction): void {
  const refusal = refusalOf(req.method, req.headers);
  if (refusal === null) {
    next();
    return;
  }
  res.status(refusal.status).json(refusal.toBody());
}
