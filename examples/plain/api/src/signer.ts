// Signing a request to the PSP Merchant API, scheme v1, by the platform's request-signing rules.
//
//   string to sign  = "v1" \n METHOD \n TARGET \n X-Api-Timestamp \n X-Api-Nonce \n hex(sha256(body))
//   X-Api-Signature = "v1=" + hex(HMAC-SHA256(key = UTF-8 bytes of the API secret, message = string to sign))
//
// This file depends on node:crypto only: copy it into your backend as is. Sign every attempt anew (a retry gets a new
// timestamp, nonce and signature), sign exactly the bytes you send, and never send or log the secret.
import { createHash, createHmac, randomUUID } from 'node:crypto';

/** SHA-256 of an empty body: every GET, DELETE and POST without a body is signed with it. */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Lower-case hex SHA-256 of the bytes (a string is hashed as UTF-8). */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The six lines joined by a single `\n` (0x0A), no newline at the end. The method is upper-cased. */
export function buildStringToSign(
  method: string,
  target: string,
  timestamp: string,
  nonce: string,
  bodySha256: string,
): string {
  return ['v1', method.toUpperCase(), target, timestamp, nonce, bodySha256].join('\n');
}

/** `v1=` and 64 lower-case hex: HMAC-SHA256 keyed with the UTF-8 bytes of the secret as is (not decoded, not hashed). */
export function signString(secret: string, stringToSign: string): string {
  return `v1=${createHmac('sha256', Buffer.from(secret, 'utf8')).update(stringToSign, 'utf8').digest('hex')}`;
}

/**
 * The URL to request and its TARGET. TARGET is the path and query exactly as they go into the HTTP request line.
 * `fetch` sends `url.pathname + url.search` of a WHATWG URL, which percent-encodes Cyrillic and spaces but keeps
 * commas, so that string — not the input — is what gets signed. The fragment never leaves the client.
 */
export function resolveTarget(apiUrl: string, target: string): { url: URL; target: string } {
  if (!target.startsWith('/')) throw new TypeError('TARGET must start with "/"');
  const url = new URL(target, apiUrl);
  url.hash = '';
  return { url, target: `${url.pathname}${url.search}` };
}

/** `X-Api-Timestamp`: Unix seconds UTC, 10 digits (not milliseconds). */
export const unixSeconds = (ms: number = Date.now()): string => String(Math.floor(ms / 1000));

/** `X-Api-Nonce`: a single-use string, here a UUID v4 from the cryptographic generator. */
export const newNonce = (): string => randomUUID();

const TIMESTAMP_RE = /^[0-9]{10}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface SignRequestInput {
  /** API key `psp_pk_…`, sent as `X-Api-Key`. */
  apiKey: string;
  /** API secret `psp_sk_…`. It only keys the HMAC. */
  apiSecret: string;
  method: string;
  /** Path and query as they will be sent (see {@link resolveTarget}). */
  target: string;
  /** The body bytes as they will be sent; `null` — no body. */
  body: Uint8Array | null;
  /** Fixed time and nonce — for test vectors only. */
  timestamp?: string;
  nonce?: string;
}

export interface SignedRequest {
  /** The four signature headers to add to the request. */
  headers: { 'X-Api-Key': string; 'X-Api-Timestamp': string; 'X-Api-Nonce': string; 'X-Api-Signature': string };
  /** What was signed: compare it with `details.stringToSign` of a `401 api_auth_failed` (`bad_signature`). */
  stringToSign: string;
  bodySha256: string;
}

/** Signs one attempt of a request. */
export function signRequest(input: SignRequestInput): SignedRequest {
  const timestamp = input.timestamp ?? unixSeconds();
  const nonce = input.nonce ?? newNonce();
  if (!TIMESTAMP_RE.test(timestamp)) throw new TypeError('timestamp must be Unix seconds, exactly 10 digits');
  if (!NONCE_RE.test(nonce)) throw new TypeError('nonce must be 16–64 characters [A-Za-z0-9_-]');
  if (!input.target.startsWith('/') || input.target.includes('#')) {
    throw new TypeError('target must be the path and query of the request line: start with "/", no host, no "#"');
  }
  // An empty body and `{}` are different: an empty one is signed with the hash of the empty string
  const bodySha256 = input.body && input.body.length > 0 ? sha256Hex(input.body) : EMPTY_BODY_SHA256;
  const stringToSign = buildStringToSign(input.method, input.target, timestamp, nonce, bodySha256);
  return {
    headers: {
      'X-Api-Key': input.apiKey,
      'X-Api-Timestamp': timestamp,
      'X-Api-Nonce': nonce,
      'X-Api-Signature': signString(input.apiSecret, stringToSign),
    },
    stringToSign,
    bodySha256,
  };
}
