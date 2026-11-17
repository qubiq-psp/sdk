// A link to the PSP payment widget, by the platform's link rules. Built offline, no request to the platform:
//
//   link      = <payment page origin> + "/#" + token        (a fragment: browsers never send it to a server)
//   token     = "v1." + payload + "." + signature
//   payload   = base64url(UTF-8 JSON {k, i, e, b?, l?})       k: API key, i: invoice id, e: expiry (Unix seconds),
//                                                             b: branding, l: locale
//   signature = base64url(HMAC-SHA256(key = UTF-8 bytes of the API secret, message = "psp-checkout-v1." + payload))
//
// The rules of the options are those of `psp.checkout.createUrl()` of @qubiq-psp/sdk and of the platform. Whoever has
// the link sees the invoice: build it only for the buyer who owns the order, at every render of the order page.
// This file depends on node:crypto only: copy it into your backend.
import { createHmac } from 'node:crypto';

/** Longest lifetime of a link: 7 days (gateway `PAY_TOKEN_MAX_TTL_SECONDS`). */
export const CHECKOUT_MAX_TTL_SECONDS = 604_800;
/** Default lifetime of a link: 24 hours. */
export const CHECKOUT_DEFAULT_TTL_SECONDS = 86_400;

export interface CheckoutBranding {
  /** Shop name in the header, 1–64 characters. */
  companyName?: string;
  /** Logo: an `https:` URL up to 1024 characters, no credentials, no `#`. */
  logoUrl?: string;
  /** Accent colour, `#rrggbb`. */
  accentColor?: string;
  theme?: 'light' | 'dark' | 'auto';
  /** Order caption for the buyer, 1–100 characters, e.g. `Order #10530`. */
  title?: string;
}

export type CheckoutLocale = 'ru' | 'en';

/** Options of a link, as `psp.checkout.createUrl()` takes them. */
export interface CheckoutOptions {
  branding?: CheckoutBranding;
  locale?: CheckoutLocale;
  /** 1–604 800, default 86 400. */
  expiresInSeconds?: number;
}

export interface CheckoutLink {
  /** `{checkoutUrl}/#v1.…` — the `src` of the iframe. */
  url: string;
  token: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** A refused option; `field` is its path, e.g. `branding.logoUrl`. */
export class CheckoutInputError extends TypeError {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'CheckoutInputError';
    this.field = field;
  }
}

const KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const SECRET_RE = /^psp_sk_(test_|live_)?[0-9A-Za-z]{36}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** The keys of `b` in the platform's order: the published token vectors are built in this order. */
const BRANDING_KEYS = ['companyName', 'logoUrl', 'accentColor', 'theme', 'title'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Text of the page: length as JavaScript counts it (UTF-16 units), the same rule as gateway. */
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new CheckoutInputError(field, `must be a string of 1–${max} characters`);
  }
  if (CONTROL_RE.test(value)) throw new CheckoutInputError(field, 'must not contain control characters');
  if (value !== value.trim()) throw new CheckoutInputError(field, 'must not start or end with whitespace');
  return value;
}

function logoUrl(value: unknown): string {
  const field = 'branding.logoUrl';
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new CheckoutInputError(field, 'must be a URL of 1–1024 characters');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CheckoutInputError(field, 'must be a valid URL');
  }
  if (url.protocol !== 'https:') throw new CheckoutInputError(field, 'must be https');
  // `includes`, not `url.hash`: an empty fragment (a trailing `#`) is refused by gateway too
  if (url.username || url.password || value.includes('#')) {
    throw new CheckoutInputError(field, 'must not contain credentials or a fragment');
  }
  return value;
}

/** Checks the branding and returns it with the keys in the order of the spec; `undefined` when empty. */
function brandingPayload(branding: unknown): Record<string, string> | undefined {
  if (!isObject(branding)) throw new CheckoutInputError('branding', 'must be an object');
  for (const key of Object.keys(branding)) {
    if (!(BRANDING_KEYS as readonly string[]).includes(key)) {
      throw new CheckoutInputError(`branding.${key}`, 'is not supported');
    }
  }
  const out: Record<string, string> = {};
  for (const key of BRANDING_KEYS) {
    const value = branding[key];
    if (value === undefined) continue;
    if (key === 'companyName') out[key] = text(value, 'branding.companyName', 64);
    else if (key === 'title') out[key] = text(value, 'branding.title', 100);
    else if (key === 'logoUrl') out[key] = logoUrl(value);
    else if (key === 'accentColor') {
      if (typeof value !== 'string' || !COLOR_RE.test(value)) {
        throw new CheckoutInputError('branding.accentColor', 'must be #rrggbb');
      }
      out[key] = value;
    } else {
      if (value !== 'light' && value !== 'dark' && value !== 'auto') {
        throw new CheckoutInputError('branding.theme', 'must be light, dark or auto');
      }
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export interface CreateCheckoutTokenInput {
  /** API key `psp_pk_…`: by it gateway finds the merchant and the network. */
  apiKey: string;
  /** Its secret: it only keys the HMAC and never goes into the token. */
  apiSecret: string;
  /** The invoice, a lower-case uuid. */
  invoiceId: string;
  branding?: unknown;
  locale?: unknown;
  /** Expiry, Unix seconds. */
  expiresAt: number;
  /** Current time, Unix seconds — for tests. */
  now?: number;
}

/** Signs a checkout token. Throws {@link CheckoutInputError} on a refused option. */
export function createCheckoutToken(input: CreateCheckoutTokenInput): { token: string; expiresAt: number } {
  if (!KEY_RE.test(input.apiKey)) throw new CheckoutInputError('apiKey', 'must look like psp_pk_test_ + 24 characters');
  if (!SECRET_RE.test(input.apiSecret)) throw new CheckoutInputError('apiSecret', 'must be an API secret psp_sk_…');
  if (!UUID_RE.test(input.invoiceId)) throw new CheckoutInputError('invoiceId', 'must be a lower-case uuid');
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(input.expiresAt) || input.expiresAt <= now) {
    throw new CheckoutInputError('expiresAt', 'must be in the future');
  }
  if (input.expiresAt - now > CHECKOUT_MAX_TTL_SECONDS) {
    throw new CheckoutInputError('expiresAt', 'a link lives at most 7 days');
  }
  if (input.locale !== undefined && input.locale !== 'ru' && input.locale !== 'en') {
    throw new CheckoutInputError('locale', 'must be ru or en');
  }

  const payload: Record<string, unknown> = { k: input.apiKey, i: input.invoiceId, e: input.expiresAt };
  const branding = input.branding === undefined ? undefined : brandingPayload(input.branding);
  if (branding) payload['b'] = branding;
  if (input.locale !== undefined) payload['l'] = input.locale;

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', Buffer.from(input.apiSecret, 'utf8'))
    .update(`psp-checkout-v1.${encoded}`, 'utf8')
    .digest('base64url');
  return { token: `v1.${encoded}.${signature}`, expiresAt: input.expiresAt };
}

/**
 * The link to the payment page of an invoice, like `psp.checkout.createUrl()`. `options` is untrusted input (e.g.
 * a request body): every field is checked, an unknown one is refused.
 */
export function createCheckoutLink(
  checkoutUrl: string,
  key: { apiKey: string; apiSecret: string },
  invoiceId: string,
  options: unknown = {},
  now: number = Math.floor(Date.now() / 1000),
): CheckoutLink {
  if (!isObject(options)) throw new CheckoutInputError('body', 'must be an object');
  for (const name of Object.keys(options)) {
    if (name !== 'branding' && name !== 'locale' && name !== 'expiresInSeconds') {
      throw new CheckoutInputError(name, 'is not supported');
    }
  }
  const ttl = options['expiresInSeconds'] ?? CHECKOUT_DEFAULT_TTL_SECONDS;
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > CHECKOUT_MAX_TTL_SECONDS) {
    throw new CheckoutInputError('expiresInSeconds', `must be an integer from 1 to ${CHECKOUT_MAX_TTL_SECONDS}`);
  }
  const { token, expiresAt } = createCheckoutToken({
    ...key,
    invoiceId,
    branding: options['branding'],
    locale: options['locale'],
    expiresAt: now + ttl,
    now,
  });
  const url = new URL(checkoutUrl);
  url.hash = token;
  return { url: url.href, token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
