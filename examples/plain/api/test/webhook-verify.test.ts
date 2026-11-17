import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFUSAL_STATUS, signWebhook, verifyWebhook, type WebhookHeaders } from '../src/webhook-verify.ts';
import { OTHER_SECRET, SHOP_SECRET, WRONG_SECRET } from './helpers.ts';

// The webhook-signing example of the platform documentation ("Example with a computed signature") and its table
// "Checking your own implementation". The bodies are the byte-for-byte files of the SDK's vectors.
const TEST_BODY = readFileSync(new URL('vectors/webhook-test.json', import.meta.url));
const PAID_BODY = readFileSync(new URL('vectors/invoice-paid.json', import.meta.url));
const TS = '1790684400';
const SIG = 'v1=e35e9b0ea7e02ffcff516436483fedda7b1b01e16c65e3d4a7a61274670df250';

const headers = (over: Record<string, string | undefined> = {}): WebhookHeaders => ({
  'x-webhook-id': '0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f',
  'x-webhook-event': 'webhook.test',
  'x-webhook-timestamp': TS,
  'x-webhook-signature': SIG,
  'x-webhook-attempt': '1',
  ...over,
});
const check = (over: Partial<Parameters<typeof verifyWebhook>[0]> = {}) =>
  verifyWebhook({ headers: headers(), body: TEST_BODY, secret: SHOP_SECRET, now: Number(TS), ...over });

describe('verifyWebhook — the published vector', () => {
  it('the published signature is valid', () => {
    expect(TEST_BODY.length).toBe(279);
    expect(signWebhook(SHOP_SECRET, TS, TEST_BODY)).toBe(SIG);
    expect(check()).toEqual({
      result: 'ok',
      message: 'valid',
      timestamp: 1790684400,
      skewSeconds: 0,
      signatureValid: true,
      signedWith: 'current',
      expectedSignature: SIG,
      bodyBytes: 279,
    });
  });

  it('the body plus one byte — signature_mismatch', () => {
    const r = check({ body: Buffer.concat([TEST_BODY, Buffer.from(' ')]) });
    expect(r).toMatchObject({ result: 'signature_mismatch', signatureValid: false, signedWith: null });
  });

  it('server time 1790684701 — timestamp_out_of_window, the signature still reported valid', () => {
    expect(check({ now: 1790684701 })).toMatchObject({
      result: 'timestamp_out_of_window',
      signatureValid: true,
      skewSeconds: 301,
    });
  });

  it('the Python re-serialised body gives the documented signature, which does not match', () => {
    const reserialised = Buffer.from(
      '{"id": "0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f", "type": "webhook.test", "version": 1, "occurredAt": "2026-09-29T12:20:00.214Z", "network": "tron", "chain": "nile", "merchantId": "6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13", "data": {"test": true, "message": "\\u041f\\u0440\\u043e\\u0432\\u0435\\u0440\\u043a\\u0430 \\u043f\\u043e\\u0441\\u043b\\u0435 \\u0441\\u043c\\u0435\\u043d\\u044b URL"}}',
    );
    expect(signWebhook(SHOP_SECRET, TS, reserialised)).toBe(
      'v1=0cf30e6f6faf9ec083a56489f1758f33ec198fe1340f95dca012be7b88f7fd4f',
    );
    expect(check({ body: reserialised }).result).toBe('signature_mismatch');
  });
});

describe('verifyWebhook — the table "Checking your own implementation"', () => {
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(TEST_BODY.toString('utf8')), null, 1));
  const rows: [string, Partial<Parameters<typeof verifyWebhook>[0]>, string][] = [
    ['1: as published', {}, 'ok'],
    ['2: exactly 300 s', { now: 1790684700 }, 'ok'],
    ['3: 301 s', { now: 1790684701 }, 'timestamp_out_of_window'],
    ['4: a newline at the end', { body: Buffer.concat([TEST_BODY, Buffer.from('\n')]) }, 'signature_mismatch'],
    ['5: re-serialised JSON', { body: reserialised }, 'signature_mismatch'],
    ['6: another last character of the secret', { secret: WRONG_SECRET }, 'signature_mismatch'],
    [
      '7: the signature in upper case',
      { headers: headers({ 'x-webhook-signature': SIG.toUpperCase() }) },
      'bad_signature_header',
    ],
    ['8: a space after the timestamp', { headers: headers({ 'x-webhook-timestamp': `${TS} ` }) }, 'bad_timestamp'],
    [
      '9: invoice.paid, 1530 bytes',
      {
        body: PAID_BODY,
        now: 1790683568,
        headers: {
          'x-webhook-id': 'c65065bb-9874-49d4-b44b-4930a167a5c1',
          'x-webhook-event': 'invoice.paid',
          'x-webhook-timestamp': '1790683568',
          'x-webhook-signature': 'v1=295caa04b9830dd6669011d09cd5b0a5e4d3bf7bcc4a9c8d9cdd943216026433',
          'x-webhook-attempt': '1',
        },
      },
      'ok',
    ],
  ];
  it.each(rows)('%s', (_name, over, result) => {
    expect(check(over).result).toBe(result);
  });

  it('9: the second attempt of invoice.paid has its own signature', () => {
    expect(PAID_BODY.length).toBe(1530);
    expect(signWebhook(SHOP_SECRET, '1790683579', PAID_BODY)).toBe(
      'v1=9dfde3aed23fa92b06cfec5595976a2107ec8834189514cd5b1d12b716e9e87e',
    );
  });
});

describe('verifyWebhook — rotation, order of the steps, the body', () => {
  it('the previous secret matches as previous; neither — signature_mismatch', () => {
    expect(check({ secret: OTHER_SECRET, previousSecret: SHOP_SECRET })).toMatchObject({
      result: 'ok',
      signedWith: 'previous',
      // the expected signature is always the one of the current secret
      expectedSignature: signWebhook(OTHER_SECRET, TS, TEST_BODY),
    });
    expect(check({ secret: OTHER_SECRET, previousSecret: WRONG_SECRET })).toMatchObject({
      result: 'signature_mismatch',
      signedWith: null,
    });
  });

  it('missing headers: the signature ones first, then id and event after a valid signature', () => {
    expect(check({ headers: headers({ 'x-webhook-signature': undefined }) }).result).toBe('missing_header');
    expect(check({ headers: headers({ 'x-webhook-timestamp': undefined }) })).toMatchObject({
      result: 'missing_header',
      expectedSignature: null,
      timestamp: null,
    });
    expect(check({ headers: headers({ 'x-webhook-id': undefined }) }).result).toBe('missing_header');
    // without a valid signature a missing id is not looked at
    expect(check({ secret: WRONG_SECRET, headers: headers({ 'x-webhook-id': undefined }) }).result).toBe(
      'signature_mismatch',
    );
  });

  it('the window is checked before the signature format', () => {
    expect(check({ now: 1790690000, headers: headers({ 'x-webhook-signature': 'v1=xyz' }) }).result).toBe(
      'timestamp_out_of_window',
    );
  });

  const signed = (body: object | string, over: Record<string, string> = {}) => {
    const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    return check({
      body: bytes,
      headers: headers({ 'x-webhook-signature': signWebhook(SHOP_SECRET, TS, bytes), ...over }),
    });
  };
  const event = JSON.parse(TEST_BODY.toString('utf8')) as Record<string, unknown>;

  it('body checks after a valid signature: bad_body, id_mismatch, type_mismatch, unsupported_version', () => {
    expect(signed('not json').result).toBe('bad_body');
    expect(signed('[1]').result).toBe('bad_body');
    expect(signed({ ...event, merchantId: undefined }).result).toBe('bad_body');
    expect(signed(event, { 'x-webhook-id': 'c65065bb-9874-49d4-b44b-4930a167a5c1' }).result).toBe('id_mismatch');
    expect(signed(event, { 'x-webhook-event': 'invoice.paid' }).result).toBe('type_mismatch');
    expect(signed({ ...event, version: 2 }).result).toBe('unsupported_version');
  });

  it('chain_mismatch: a testnet secret refuses mainnet webhooks', () => {
    expect(signed({ ...event, chain: 'mainnet' })).toMatchObject({ result: 'chain_mismatch', signatureValid: true });
    expect(signed({ ...event, chain: 'sepolia' }).result).toBe('ok');
  });

  it('the statuses: 401 for the signature and the chain, 400 for the body', () => {
    expect(REFUSAL_STATUS.signature_mismatch).toBe(401);
    expect(REFUSAL_STATUS.chain_mismatch).toBe(401);
    expect(REFUSAL_STATUS.bad_body).toBe(400);
    expect(REFUSAL_STATUS.unsupported_version).toBe(400);
  });
});
