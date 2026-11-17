// The three signatures of the platform, written from the gateway and webhook-service docs (not from the SDK):
// the API request (gateway 13.2), the webhook (webhook-service 13.6) and the payment-widget token (gateway 20.2).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** SHA-256 of an empty body. */
export const EMPTY_BODY_SHA256 = sha256Hex('');

export interface ApiSignatureInput {
  secret: string;
  method: string;
  /** Path and query exactly as in the request line. */
  target: string;
  timestamp: string;
  nonce: string;
  body: string | Uint8Array;
}

/** gateway 13.2: six lines joined with `\n`, HMAC-SHA256 with the secret, `v1=` and lowercase hex. */
export function signApiRequest(input: ApiSignatureInput): { stringToSign: string; signature: string } {
  const stringToSign = ['v1', input.method, input.target, input.timestamp, input.nonce, sha256Hex(input.body)].join(
    '\n',
  );
  const signature = `v1=${createHmac('sha256', input.secret).update(stringToSign, 'utf8').digest('hex')}`;
  return { stringToSign, signature };
}

/** webhook-service 13.6: `v1=` + hex HMAC-SHA256 of `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: string | number, body: string | Uint8Array): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`, 'utf8');
  hmac.update(body);
  return `v1=${hmac.digest('hex')}`;
}

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface CheckoutPayload {
  k: string;
  i: string;
  e: number;
  b?: Record<string, string>;
  l?: 'ru' | 'en';
}

export type CheckoutTokenCheck =
  | { valid: true; payload: CheckoutPayload }
  | { valid: false; reason: 'format' | 'bad_signature' | 'bad_payload'; payload?: unknown };

const TOKEN_RE = /^v1\.([A-Za-z0-9_-]{1,4000})\.([A-Za-z0-9_-]{43})$/;
const PAYLOAD_FIELDS = new Set(['k', 'i', 'e', 'b', 'l']);
const BRANDING_FIELDS = new Set(['companyName', 'logoUrl', 'accentColor', 'theme', 'title']);

/** gateway 20.2: `v1.<payload>.<signature>`, signature = base64url HMAC-SHA256(secret, "psp-checkout-v1." + payload). */
export function signCheckoutPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`psp-checkout-v1.${payload}`, 'utf8').digest('base64url');
}

/** Verifies a payment-widget token with the secret and checks the payload fields of gateway 20.2–20.3. */
export function verifyCheckoutToken(token: string, secret: string): CheckoutTokenCheck {
  const match = TOKEN_RE.exec(token);
  if (!match || token.length > 4096) return { valid: false, reason: 'format' };
  const [, payload = '', signature = ''] = match;
  if (!safeEqual(signCheckoutPayload(secret, payload), signature)) return { valid: false, reason: 'bad_signature' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }
  const p = parsed as Record<string, unknown>;
  const ok =
    p !== null &&
    typeof p === 'object' &&
    Object.keys(p).every((k) => PAYLOAD_FIELDS.has(k)) &&
    typeof p['k'] === 'string' &&
    /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/.test(p['k']) &&
    typeof p['i'] === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p['i']) &&
    Number.isInteger(p['e']) &&
    (p['l'] === undefined || p['l'] === 'ru' || p['l'] === 'en') &&
    (p['b'] === undefined ||
      (typeof p['b'] === 'object' && p['b'] !== null && Object.keys(p['b']).every((k) => BRANDING_FIELDS.has(k))));
  return ok
    ? { valid: true, payload: p as unknown as CheckoutPayload }
    : { valid: false, reason: 'bad_payload', payload: p };
}
