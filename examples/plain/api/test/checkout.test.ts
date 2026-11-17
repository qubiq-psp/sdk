import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CheckoutInputError, createCheckoutLink, createCheckoutToken } from '../src/checkout.ts';
import type { CheckoutLinkView, ExampleError } from '../src/types.ts';
import { makeApp, SHOP_KEY, SHOP_SECRET, WRONG_SECRET } from './helpers.ts';

// The published test vectors of the payment-widget token
const INVOICE = '97da92f5-45c0-411b-9ed5-6793b396cd5f';
const EXP = 1790769600;
const NOW = 1790683200;
const JSON_1 =
  '{"k":"psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp","i":"97da92f5-45c0-411b-9ed5-6793b396cd5f","e":1790769600,"b":{"companyName":"Shop Example","logoUrl":"https://shop.example/logo.png","accentColor":"#4f46e5","theme":"auto","title":"Заказ 10530"},"l":"ru"}';
const PAYLOAD_1 =
  'eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwLCJiIjp7ImNvbXBhbnlOYW1lIjoiU2hvcCBFeGFtcGxlIiwibG9nb1VybCI6Imh0dHBzOi8vc2hvcC5leGFtcGxlL2xvZ28ucG5nIiwiYWNjZW50Q29sb3IiOiIjNGY0NmU1IiwidGhlbWUiOiJhdXRvIiwidGl0bGUiOiLQl9Cw0LrQsNC3IDEwNTMwIn0sImwiOiJydSJ9';
const SIGNATURE_1 = 'IzC8fVLRewHK1Xx33zRBoVFi1aMIHgRxJdk5C0vb70Y';
const JSON_2 = '{"k":"psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp","i":"97da92f5-45c0-411b-9ed5-6793b396cd5f","e":1790769600}';
const PAYLOAD_2 =
  'eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwfQ';
const SIGNATURE_2 = 'guQrxJw9m2RlbNRkL3FPI08BJHsr_WzByGV6XPXrlak';
const TOKEN_2 = `v1.${PAYLOAD_2}.${SIGNATURE_2}`;
const BRANDING_1 = {
  companyName: 'Shop Example',
  logoUrl: 'https://shop.example/logo.png',
  accentColor: '#4f46e5',
  theme: 'auto',
  title: 'Заказ 10530',
} as const;

const base = { apiKey: SHOP_KEY, apiSecret: SHOP_SECRET, invoiceId: INVOICE, expiresAt: EXP, now: NOW };
const sign = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('base64url');
const fieldOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof CheckoutInputError) return err.field;
    throw err;
  }
  throw new Error('no error');
};

describe('createCheckoutToken — the published token vectors', () => {
  it('vector 1: with branding and locale', () => {
    expect(Buffer.byteLength(JSON_1)).toBe(249);
    expect(Buffer.from(PAYLOAD_1, 'base64url').toString('utf8')).toBe(JSON_1);
    const { token, expiresAt } = createCheckoutToken({ ...base, branding: BRANDING_1, locale: 'ru' });
    expect(token).toBe(`v1.${PAYLOAD_1}.${SIGNATURE_1}`);
    expect(token).toHaveLength(379);
    expect(expiresAt).toBe(EXP);
  });

  it('vector 1: the branding keys come out in the order of the spec whatever the input order', () => {
    const { token } = createCheckoutToken({
      ...base,
      locale: 'ru',
      branding: {
        title: 'Заказ 10530',
        theme: 'auto',
        accentColor: '#4f46e5',
        logoUrl: 'https://shop.example/logo.png',
        companyName: 'Shop Example',
      },
    });
    expect(token).toBe(`v1.${PAYLOAD_1}.${SIGNATURE_1}`);
  });

  it('vector 2: without branding; an empty branding object is the same', () => {
    expect(Buffer.byteLength(JSON_2)).toBe(97);
    expect(Buffer.from(PAYLOAD_2, 'base64url').toString('utf8')).toBe(JSON_2);
    expect(createCheckoutToken(base).token).toBe(TOKEN_2);
    expect(createCheckoutToken({ ...base, branding: {} }).token).toBe(TOKEN_2);
    expect(TOKEN_2).toHaveLength(177);
  });

  it('the negative cases of vector 2: another secret, the API prefix, a changed payload', () => {
    expect(createCheckoutToken({ ...base, apiSecret: WRONG_SECRET }).token).toBe(
      `v1.${PAYLOAD_2}.R2Sq_oZLnUaUvY2MI6am92r3ssIx5DjdyKw86qjtAKo`,
    );
    expect(sign(SHOP_SECRET, `v1.${PAYLOAD_2}`)).toBe('DtreNmaTLcNJkb-XLLyIzHH3Rl2X8zhwxbFIvfGDthw');
    expect(sign(SHOP_SECRET, `psp-checkout-v1.${PAYLOAD_2.slice(0, -1)}R`)).not.toBe(SIGNATURE_2);
  });
});

describe('createCheckoutToken — the option rules of the link', () => {
  it('refuses a malformed key, secret, invoice id or expiry', () => {
    expect(fieldOf(() => createCheckoutToken({ ...base, apiKey: 'psp_pk_short' }))).toBe('apiKey');
    expect(fieldOf(() => createCheckoutToken({ ...base, apiSecret: 'secret' }))).toBe('apiSecret');
    expect(fieldOf(() => createCheckoutToken({ ...base, invoiceId: INVOICE.toUpperCase() }))).toBe('invoiceId');
    expect(fieldOf(() => createCheckoutToken({ ...base, expiresAt: NOW }))).toBe('expiresAt');
    expect(fieldOf(() => createCheckoutToken({ ...base, expiresAt: NOW + 604_801 }))).toBe('expiresAt');
    expect(createCheckoutToken({ ...base, expiresAt: NOW + 604_800 }).expiresAt).toBe(NOW + 604_800);
    expect(createCheckoutToken({ ...base, expiresAt: NOW + 1 }).expiresAt).toBe(NOW + 1);
  });

  it('refuses branding that could carry markup or a non-https logo', () => {
    const bad = (branding: object) => fieldOf(() => createCheckoutToken({ ...base, branding }));
    expect(bad({ companyName: '' })).toBe('branding.companyName');
    expect(bad({ companyName: 'x'.repeat(65) })).toBe('branding.companyName');
    expect(bad({ companyName: 'Shop\u0000' })).toBe('branding.companyName');
    expect(bad({ companyName: 'Shop\u007f' })).toBe('branding.companyName');
    expect(bad({ companyName: ' Shop' })).toBe('branding.companyName');
    expect(bad({ companyName: 'Shop ' })).toBe('branding.companyName');
    expect(bad({ logoUrl: 'http://shop.example/logo.png' })).toBe('branding.logoUrl');
    expect(bad({ logoUrl: 'javascript:alert(1)' })).toBe('branding.logoUrl');
    expect(bad({ logoUrl: 'https://user:pass@shop.example/logo.png' })).toBe('branding.logoUrl');
    expect(bad({ logoUrl: 'https://shop.example/logo.png#x' })).toBe('branding.logoUrl');
    expect(bad({ logoUrl: 'https://shop.example/logo.png#' })).toBe('branding.logoUrl');
    expect(bad({ logoUrl: `https://shop.example/${'a'.repeat(1004)}` })).toBe('branding.logoUrl');
    expect(bad({ accentColor: 'red' })).toBe('branding.accentColor');
    expect(bad({ theme: 'neon' })).toBe('branding.theme');
    expect(bad({ title: 'x'.repeat(101) })).toBe('branding.title');
    expect(bad({ html: '<b>' })).toBe('branding.html');
    expect(fieldOf(() => createCheckoutToken({ ...base, branding: 'x' }))).toBe('branding');
    expect(fieldOf(() => createCheckoutToken({ ...base, locale: 'de' }))).toBe('locale');
  });

  it('counts the length as JavaScript does (UTF-16), like gateway: 32 emoji fit, 33 do not', () => {
    expect(() => createCheckoutToken({ ...base, branding: { companyName: '🛒'.repeat(32) } })).not.toThrow();
    expect(fieldOf(() => createCheckoutToken({ ...base, branding: { companyName: '🛒'.repeat(33) } }))).toBe(
      'branding.companyName',
    );
    expect(() => createCheckoutToken({ ...base, branding: { title: 'Я'.repeat(100) } })).not.toThrow();
  });
});

describe('createCheckoutLink', () => {
  const key = { apiKey: SHOP_KEY, apiSecret: SHOP_SECRET };

  it('origin + "/#" + token, the expiry counted from now', () => {
    expect(createCheckoutLink('https://pay.psp.qubiq.cc', key, INVOICE, { expiresInSeconds: EXP - NOW }, NOW)).toEqual({
      url: `https://pay.psp.qubiq.cc/#${TOKEN_2}`,
      token: TOKEN_2,
      expiresAt: '2026-09-30T12:00:00.000Z',
    });
    expect(createCheckoutLink('https://pay.psp.qubiq.cc', key, INVOICE, {}, NOW).expiresAt).toBe(
      new Date((NOW + 86_400) * 1000).toISOString(),
    );
  });

  it('expiresInSeconds 1–604800 integers; unknown options refused', () => {
    const field = (options: unknown) => fieldOf(() => createCheckoutLink('https://pay.example', key, INVOICE, options));
    expect(field({ expiresInSeconds: 0 })).toBe('expiresInSeconds');
    expect(field({ expiresInSeconds: 1.5 })).toBe('expiresInSeconds');
    expect(field({ expiresInSeconds: 604_801 })).toBe('expiresInSeconds');
    expect(field({ expiresInSeconds: '60' })).toBe('expiresInSeconds');
    expect(field({ extra: 1 })).toBe('extra');
    expect(field([])).toBe('body');
  });
});

describe('POST /api/invoices/{invoiceId}/checkout-link', () => {
  const url = `/api/invoices/${INVOICE}/checkout-link`;

  it('signs a link with the secret of the environment: 24 h by default, no platform call', async () => {
    const { app, log } = await makeApp();
    const before = Math.floor(Date.now() / 1000);
    const res = await app.inject({ method: 'POST', url, payload: { branding: BRANDING_1, locale: 'ru' } });
    expect(res.statusCode).toBe(200);
    const link = res.json<CheckoutLinkView>();
    expect(link.url).toBe(`https://pay.psp.qubiq.cc/#${link.token}`);
    const [version, payload = '', signature] = link.token.split('.');
    expect(version).toBe('v1');
    expect(signature).toBe(sign(SHOP_SECRET, `psp-checkout-v1.${payload}`));
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e: number };
    expect(decoded).toEqual({ k: SHOP_KEY, i: INVOICE, e: decoded.e, b: BRANDING_1, l: 'ru' });
    expect(decoded.e - before).toBeGreaterThanOrEqual(86_400);
    expect(decoded.e - before).toBeLessThanOrEqual(86_401);
    expect(link.expiresAt).toBe(new Date(decoded.e * 1000).toISOString());
    expect(res.body).not.toContain(SHOP_SECRET);
    expect(res.headers['x-example-call-id']).toBeUndefined();
    expect(log.page(() => true, 1, 50).total).toBe(0);
  });

  it('no body, an empty body, http checkout on localhost', async () => {
    const { app } = await makeApp({ PSP_CHECKOUT_URL: 'http://127.0.0.1:4999' });
    const none = await app.inject({ method: 'POST', url });
    expect(none.statusCode).toBe(200);
    const link = none.json<CheckoutLinkView>();
    expect(link.url.startsWith('http://127.0.0.1:4999/#v1.')).toBe(true);
    const decoded = JSON.parse(Buffer.from(link.token.split('.')[1]!, 'base64url').toString('utf8')) as object;
    expect(Object.keys(decoded)).toEqual(['k', 'i', 'e']);
    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(200);
  });

  it('400 example_invalid_request with the field', async () => {
    const { app } = await makeApp();
    const post = async (payload: unknown, path = url) => {
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: { 'content-type': 'application/json' },
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      expect(res.statusCode).toBe(400);
      return res.json<ExampleError>();
    };
    expect(await post({ branding: { logoUrl: 'http://shop.example/logo.png' } })).toEqual({
      errorCode: 'example_invalid_request',
      errorMessage: 'branding.logoUrl: must be https',
      details: { field: 'branding.logoUrl', message: 'must be https' },
    });
    expect((await post({ locale: 'de' })).details).toMatchObject({ field: 'locale' });
    expect((await post({ expiresInSeconds: 604_801 })).details).toMatchObject({ field: 'expiresInSeconds' });
    expect((await post({ extra: 1 })).details).toMatchObject({ field: 'extra' });
    expect((await post('{not json')).details).toMatchObject({ field: 'body' });
    expect((await post({}, `/api/invoices/${INVOICE.toUpperCase()}/checkout-link`)).details).toMatchObject({
      field: 'invoiceId',
    });
  });

  it('neither the secret nor the token gets into the server log', async () => {
    const lines: string[] = [];
    const { app } = await makeApp({}, { logger: { write: (line) => lines.push(line) } });
    const link = (
      await app.inject({ method: 'POST', url, payload: { branding: BRANDING_1 } })
    ).json<CheckoutLinkView>();
    const log = lines.join('');
    expect(log).toContain('checkout link built');
    expect(log).toContain(INVOICE);
    expect(log).not.toContain(SHOP_SECRET);
    expect(log).not.toContain(link.token.split('.')[1]);
    expect(log).not.toContain(link.token.split('.')[2]);
  });
});
