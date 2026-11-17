import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildStringToSign,
  EMPTY_BODY_SHA256,
  resolveTarget,
  sha256Hex,
  signRequest,
  signString,
} from '../src/signer.ts';
import { SHOP_KEY, SHOP_SECRET, WRONG_SECRET } from './helpers.ts';

// The published test vectors of the request signature
const BODY_1 =
  '{"externalId":"order-10530","network":"tron","asset":"USDT","amount":"50","description":"Заказ 10530","metadata":{"orderId":"10530"}}';
const TS_1 = '1790683200';
const NONCE_1 = '6f1c2a9e-4b7d-4e21-9a3c-8d5f0b2e7c41';
const TARGET_2 = '/api/v1/invoices?status=active,partially_paid&limit=20';
const TS_2 = '1790683260';
const NONCE_2 = 'b2d4f6a8-1c3e-4f50-8a7b-9c0d1e2f3a4b';

const vector1 = (body: string, extra: Partial<Parameters<typeof signRequest>[0]> = {}) =>
  signRequest({
    apiKey: SHOP_KEY,
    apiSecret: SHOP_SECRET,
    method: 'POST',
    target: '/api/v1/invoices',
    body: Buffer.from(body, 'utf8'),
    timestamp: TS_1,
    nonce: NONCE_1,
    ...extra,
  });
const vector2 = (target: string) =>
  signRequest({
    apiKey: SHOP_KEY,
    apiSecret: SHOP_SECRET,
    method: 'GET',
    target,
    body: null,
    timestamp: TS_2,
    nonce: NONCE_2,
  });

describe('signRequest — the published vectors', () => {
  it('vector 1: POST with a Cyrillic body', () => {
    expect(Buffer.byteLength(BODY_1)).toBe(138);
    const s = vector1(BODY_1);
    expect(s.bodySha256).toBe('c3e5c7ad5ff7b2b32958d47b76dccfa8587be1882fefb19f393a6652990008d1');
    expect(s.stringToSign).toBe(`v1\nPOST\n/api/v1/invoices\n${TS_1}\n${NONCE_1}\n${s.bodySha256}`);
    expect(Buffer.byteLength(s.stringToSign)).toBe(137);
    expect(s.headers).toEqual({
      'X-Api-Key': SHOP_KEY,
      'X-Api-Timestamp': TS_1,
      'X-Api-Nonce': NONCE_1,
      'X-Api-Signature': 'v1=e2fda22d1cbec087e2edc769f9bfc2368c29fd43aff2f36822fa19d9396463d9',
    });
  });

  it('vector 2: GET with a query and no body', () => {
    const s = vector2(TARGET_2);
    expect(s.bodySha256).toBe(EMPTY_BODY_SHA256);
    expect(Buffer.byteLength(s.stringToSign)).toBe(174);
    expect(s.headers['X-Api-Signature']).toBe('v1=e336ed5f635db2db5de16f78a38feb28c86dd5245a0d92a2f2cf0f54e503d5f9');
  });
});

describe('signRequest — the negative rows of "Checking your own implementation"', () => {
  const sig = (s: { headers: { 'X-Api-Signature': string } }) => s.headers['X-Api-Signature'];

  it('3: the body of Python json.dumps (170 bytes) is another signature', () => {
    const dumped =
      '{"externalId": "order-10530", "network": "tron", "asset": "USDT", "amount": "50", "description": "\\u0417\\u0430\\u043a\\u0430\\u0437 10530", "metadata": {"orderId": "10530"}}';
    expect(Buffer.byteLength(dumped)).toBe(170);
    expect(sig(vector1(dumped))).toBe('v1=8f3d573e923659b4f914d3f7f09ff27ffbaae1efb4a077a6b7a17a57e23f7696');
  });

  it('4: the body plus a newline', () => {
    expect(sig(vector1(`${BODY_1}\n`))).toBe('v1=2e6165861be82a3d72c1cef75fb110c12735c05b391960282492f6d904d1a310');
  });

  it('5 and 6: a newline after the body hash, the method in lower case — strings our signer never builds', () => {
    const right = buildStringToSign('POST', '/api/v1/invoices', TS_1, NONCE_1, sha256Hex(BODY_1));
    expect(signString(SHOP_SECRET, `${right}\n`)).toBe(
      'v1=75f067cdbef871f45f4d164270326c031d5fb314db8733918eff03fb2d70247d',
    );
    const lower = right.replace('\nPOST\n', '\npost\n');
    expect(signString(SHOP_SECRET, lower)).toBe('v1=9d4fb5f0b5d6c0d94e0d52b58e491142d9cd5109f93dd9e73e499280f6cce2f6');
    // buildStringToSign upper-cases the method itself
    expect(buildStringToSign('post', '/api/v1/invoices', TS_1, NONCE_1, sha256Hex(BODY_1))).toBe(right);
  });

  it('7: the secret …Uq4M — the same string to sign, another signature', () => {
    const wrong = vector1(BODY_1, { apiSecret: WRONG_SECRET });
    expect(wrong.stringToSign).toBe(vector1(BODY_1).stringToSign);
    expect(sig(wrong)).toBe('v1=c565da8aec7cb9a1ffd9f1d2e5e72026f80f0e393b2d10bd04ea270f6861ed5f');
  });

  it('8: the key is the UTF-8 secret as is, not sha256(secret)', () => {
    const s = vector1(BODY_1);
    const hashedKey = createHash('sha256').update(SHOP_SECRET).digest();
    const wrong = `v1=${createHmac('sha256', hashedKey).update(s.stringToSign).digest('hex')}`;
    expect(wrong).toBe('v1=505fcfff3388c243506ef90fbd9648904ee00657191a5501c89eafb2aa49306b');
    expect(sig(s)).not.toBe(wrong);
  });

  it('9–12: TARGET is byte for byte what is sent — encoded comma, order, query, no host', () => {
    expect(sig(vector2('/api/v1/invoices?status=active%2Cpartially_paid&limit=20'))).toBe(
      'v1=453a7c48e1d7d30fb8b0efc8918ba064e8549d58bcc084d67199af1740303db4',
    );
    expect(sig(vector2('/api/v1/invoices?limit=20&status=active,partially_paid'))).toBe(
      'v1=affa3dbbb6ce1b4ee17ecd53d55c5035a2cfa7d5bef79eb68bd5862396b0afb9',
    );
    expect(sig(vector2('/api/v1/invoices'))).toBe(
      'v1=f91aa50c250f4111e4c0e412729b639e1fc1c73286ff64aac225660edb292f6b',
    );
    // 12: with the scheme and host — signString shows the value; signRequest refuses such a target
    const withHost = buildStringToSign(
      'GET',
      `https://api.nile.psp.example${TARGET_2}`,
      TS_2,
      NONCE_2,
      EMPTY_BODY_SHA256,
    );
    expect(signString(SHOP_SECRET, withHost)).toBe(
      'v1=ed69a23f02d7758a78844a9f06fd713868615ae8ac3f0eeb5b12ec88f7758c9f',
    );
    expect(() => vector2(`https://api.nile.psp.example${TARGET_2}`)).toThrow(TypeError);
  });

  it('13 and 14: the signature is v1= and lower-case hex; a timestamp in milliseconds is refused', () => {
    expect(sig(vector1(BODY_1))).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(() => vector1(BODY_1, { timestamp: '1790683200000' })).toThrow(/10 digits/);
    expect(() => vector1(BODY_1, { nonce: 'short' })).toThrow(/nonce/);
  });

  it('{} is not an empty body', () => {
    expect(sha256Hex('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    expect(vector1('').bodySha256).toBe(EMPTY_BODY_SHA256);
    expect(
      signRequest({ apiKey: SHOP_KEY, apiSecret: SHOP_SECRET, method: 'GET', target: '/', body: null }),
    ).toMatchObject({ bodySha256: EMPTY_BODY_SHA256 });
  });

  it('a fresh timestamp and nonce for every call', () => {
    const a = signRequest({ apiKey: SHOP_KEY, apiSecret: SHOP_SECRET, method: 'GET', target: '/x', body: null });
    const b = signRequest({ apiKey: SHOP_KEY, apiSecret: SHOP_SECRET, method: 'GET', target: '/x', body: null });
    expect(a.headers['X-Api-Timestamp']).toMatch(/^[0-9]{10}$/);
    expect(a.headers['X-Api-Nonce']).not.toBe(b.headers['X-Api-Nonce']);
  });
});

describe('resolveTarget', () => {
  it('keeps commas and order, encodes Cyrillic and spaces, drops the fragment', () => {
    expect(resolveTarget('https://api.psp.qubiq.cc', '/api/v1/invoices?limit=20&status=active,paid').target).toBe(
      '/api/v1/invoices?limit=20&status=active,paid',
    );
    expect(resolveTarget('https://api.psp.qubiq.cc', '/api/v1/invoices?externalId=заказ 1#x').target).toBe(
      '/api/v1/invoices?externalId=%D0%B7%D0%B0%D0%BA%D0%B0%D0%B7%201',
    );
    expect(resolveTarget('http://127.0.0.1:4000', '/api/v1/account').url.href).toBe(
      'http://127.0.0.1:4000/api/v1/account',
    );
  });

  it('refuses a target without a leading slash', () => {
    expect(() => resolveTarget('https://api.psp.qubiq.cc', 'api/v1/account')).toThrow();
  });
});
