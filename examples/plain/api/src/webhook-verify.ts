// Verifying a PSP webhook by the platform's webhook-signing rules.
//
//   string to sign      = X-Webhook-Timestamp + "." + the raw body bytes
//   X-Webhook-Signature = "v1=" + hex(HMAC-SHA256(key = UTF-8 bytes of the API secret, message = string to sign))
//
// Steps, in order (the first failure is the result):
//   1. X-Webhook-Timestamp and X-Webhook-Signature are present            → missing_header
//   2. the timestamp is digits only                                          → bad_timestamp
//   3. it is within ±300 s of this server's clock                            → timestamp_out_of_window
//   4. the signature is `v1=` and 64 lower-case hex                          → bad_signature_header
//   5. HMAC with the secret (or the previous one during a rotation),
//      compared in constant time                                             → signature_mismatch
//   6. only now the JSON: X-Webhook-Id and X-Webhook-Event present           → missing_header
//      a JSON object with id, type, chain, merchantId, data                  → bad_body
//      id equals X-Webhook-Id, type equals X-Webhook-Event                   → id_mismatch, type_mismatch
//      version 1                                                             → unsupported_version
//      `chain` belongs to the network of the secret (mainnet for live)       → chain_mismatch
// Answer 401 to the signature failures and chain_mismatch, 400 to the body failures, 2xx to a valid webhook (also to a
// duplicate by `id`). The reasons and statuses are those of `verifyWebhook()` of @qubiq-psp/sdk.
//
// This file depends on node:crypto only: copy it into your backend. Read the body as raw bytes before any JSON parser.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The window of `X-Webhook-Timestamp` around the clock of this server, seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookVerifyResult =
  | 'ok'
  | 'missing_header'
  | 'bad_timestamp'
  | 'timestamp_out_of_window'
  | 'bad_signature_header'
  | 'signature_mismatch'
  | 'bad_body'
  | 'id_mismatch'
  | 'type_mismatch'
  | 'unsupported_version'
  | 'chain_mismatch';

/** The HTTP status to answer a refused webhook with; any non-2xx makes the platform retry later. */
export const REFUSAL_STATUS: Record<Exclude<WebhookVerifyResult, 'ok'>, 400 | 401> = {
  missing_header: 401,
  bad_timestamp: 401,
  timestamp_out_of_window: 401,
  bad_signature_header: 401,
  signature_mismatch: 401,
  bad_body: 400,
  id_mismatch: 400,
  type_mismatch: 400,
  unsupported_version: 400,
  chain_mismatch: 401,
};

/** Request headers as Node.js gives them: names in lower case. */
export type WebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyWebhookInput {
  headers: WebhookHeaders;
  /** The raw body bytes exactly as they arrived. */
  body: Buffer;
  /** The API secret `psp_sk_…` of the network the webhooks come from. */
  secret: string;
  /** The previous secret during a rotation; the webhook passes if it matches either. */
  previousSecret?: string | null;
  /** The current time, Unix seconds — for tests. */
  now?: number;
}

export interface WebhookVerification {
  /** `ok` or the first failed step. */
  result: WebhookVerifyResult;
  /** Why, in English. */
  message: string;
  /** `X-Webhook-Timestamp` when it is digits, else `null`. */
  timestamp: number | null;
  /** Server time minus `timestamp`. */
  skewSeconds: number | null;
  /** The signature matches a configured secret — reported even when another step (e.g. the window) failed. */
  signatureValid: boolean;
  /** Which secret matched. */
  signedWith: 'current' | 'previous' | null;
  /** `v1=…` computed with the current secret, `null` without a usable timestamp. Not a secret: it is per body. */
  expectedSignature: string | null;
  bodyBytes: number;
}

/** `v1=<hex>` of a webhook body: also handy to sign fake webhooks in the tests of your handler. */
export function signWebhook(secret: string, timestamp: string, body: Buffer): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'));
  mac.update(`${timestamp}.`, 'utf8');
  mac.update(body);
  return `v1=${mac.digest('hex')}`;
}

/** Constant-time comparison of two `v1=<64 hex>` strings of the same format. */
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function header(headers: WebhookHeaders, name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return (value as readonly string[])[0] ?? null;
  return typeof value === 'string' ? value : null;
}

const TIMESTAMP_RE = /^[0-9]{1,12}$/;
const SIGNATURE_RE = /^v1=[0-9a-f]{64}$/;

/** Verifies a webhook. Never throws for a bad request: the outcome is in `result`. */
export function verifyWebhook(input: VerifyWebhookInput): WebhookVerification {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const rawTimestamp = header(input.headers, 'x-webhook-timestamp');
  const received = header(input.headers, 'x-webhook-signature');
  const timestampOk = rawTimestamp !== null && TIMESTAMP_RE.test(rawTimestamp);
  const timestamp = timestampOk ? Number(rawTimestamp) : null;
  const skewSeconds = timestamp === null ? null : now - timestamp;

  // The signature is computed whenever the timestamp is usable: the log can then show that it is valid even when
  // the webhook is refused for the window
  const expected = timestampOk ? signWebhook(input.secret, rawTimestamp, input.body) : null;
  const previous = input.previousSecret ? input.previousSecret : null;
  const expectedPrevious = timestampOk && previous ? signWebhook(previous, rawTimestamp, input.body) : null;
  const formatOk = received !== null && SIGNATURE_RE.test(received);
  let signedWith: WebhookVerification['signedWith'] = null;
  if (formatOk && expected && sameSignature(received, expected)) signedWith = 'current';
  else if (formatOk && expectedPrevious && sameSignature(received, expectedPrevious)) signedWith = 'previous';

  const outcome = (result: WebhookVerifyResult, message: string): WebhookVerification => ({
    result,
    message,
    timestamp,
    skewSeconds,
    signatureValid: signedWith !== null,
    signedWith,
    expectedSignature: expected,
    bodyBytes: input.body.length,
  });

  // Steps 1–5: the signature
  if (rawTimestamp === null || received === null) {
    return outcome('missing_header', 'X-Webhook-Timestamp and X-Webhook-Signature are required');
  }
  if (!timestampOk || skewSeconds === null) {
    return outcome('bad_timestamp', 'X-Webhook-Timestamp must be Unix seconds, digits only');
  }
  if (Math.abs(skewSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return outcome(
      'timestamp_out_of_window',
      `X-Webhook-Timestamp is ${skewSeconds} s away from the clock of this server (window ±${WEBHOOK_TOLERANCE_SECONDS} s)`,
    );
  }
  if (!formatOk) return outcome('bad_signature_header', 'X-Webhook-Signature must be v1= and 64 lower-case hex');
  if (signedWith === null) {
    return outcome(
      'signature_mismatch',
      previous
        ? 'the signature matches neither the current nor the previous secret'
        : 'the signature does not match: check the secret and that the body is the raw bytes',
    );
  }

  // Step 6: the body, trusted now
  const id = header(input.headers, 'x-webhook-id');
  const type = header(input.headers, 'x-webhook-event');
  if (id === null || type === null) return outcome('missing_header', 'X-Webhook-Id and X-Webhook-Event are required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body.toString('utf8'));
  } catch {
    return outcome('bad_body', 'the body is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return outcome('bad_body', 'the body is not a JSON object');
  }
  const event = parsed as Record<string, unknown>;
  if (
    typeof event['id'] !== 'string' ||
    typeof event['type'] !== 'string' ||
    typeof event['chain'] !== 'string' ||
    typeof event['merchantId'] !== 'string' ||
    event['data'] === null ||
    typeof event['data'] !== 'object'
  ) {
    return outcome('bad_body', 'id, type, chain, merchantId and data are required');
  }
  if (event['id'] !== id) return outcome('id_mismatch', 'the id of the body differs from X-Webhook-Id');
  if (event['type'] !== type) return outcome('type_mismatch', 'the type of the body differs from X-Webhook-Event');
  if (event['version'] !== 1) {
    return outcome('unsupported_version', `body format version ${String(event['version'])} is not supported`);
  }
  // A live secret (`psp_sk_live_…`) takes mainnet webhooks only, a testnet secret any other chain
  const liveSecret = input.secret.startsWith('psp_sk_live_');
  if ((event['chain'] === 'mainnet') !== liveSecret) {
    return outcome(
      'chain_mismatch',
      `a ${event['chain']} webhook came to a ${liveSecret ? 'mainnet' : 'testnet'} handler`,
    );
  }
  return outcome('ok', signedWith === 'previous' ? 'valid, signed with the previous secret' : 'valid');
}
