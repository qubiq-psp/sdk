// The SSE stream, the payment-widget link and the static UI.
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY, API_SECRET, CHECKOUT_URL, startApp, testEnv, type TestApp } from './support/app';
import { PlatformStub } from './support/platform-stub';

const INVOICE_ID = '97da92f5-45c0-411b-9ed5-6793b396cd5f';

let stub: PlatformStub;
let app: TestApp;

beforeAll(async () => {
  stub = await new PlatformStub().start();
  app = await startApp(testEnv(stub.url));
});
afterAll(async () => {
  await app.close();
  await stub.stop();
});

/** Reads SSE frames until `count` events (not comments) arrived. */
async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
  buffer: { text: string },
): Promise<{ event: string; id?: string; data: Record<string, unknown> }[]> {
  const decoder = new TextDecoder();
  const events: { event: string; id?: string; data: Record<string, unknown> }[] = [];
  while (events.length < count) {
    const frames = buffer.text.split('\n\n');
    buffer.text = frames.pop() ?? '';
    for (const frame of frames) {
      const fields = Object.fromEntries(
        frame.split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]),
      );
      if (fields['event'] !== undefined) {
        events.push({
          event: fields['event'],
          id: fields['id'],
          data: JSON.parse(fields['data'] ?? 'null') as Record<string, unknown>,
        });
      }
    }
    if (events.length >= count) break;
    const { value, done } = await reader.read();
    if (done) break;
    buffer.text += decoder.decode(value, { stream: true });
  }
  return events;
}

describe('GET /api/stream', () => {
  it('sends retry and ready, then a request event per attempt and a webhook event per received webhook', async () => {
    const controller = new AbortController();
    const res = await fetch(`${app.url}/api/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const buffer = { text: '' };
    try {
      const [ready] = await readEvents(reader, 1, buffer);
      expect(ready).toMatchObject({ event: 'ready', data: { backend: 'sdk', serverTime: expect.any(String) } });

      stub.answer({ status: 200, body: {} });
      const call = await fetch(`${app.url}/api/account`);
      const [request] = await readEvents(reader, 1, buffer);
      expect(request).toMatchObject({
        event: 'request',
        data: {
          callId: call.headers.get('x-example-call-id'),
          operationId: 'getAccount',
          sdkMethod: 'account.get',
          attempt: 1,
        },
      });
      expect(request?.id).toBe(request?.data['id']);
      // The list form: no headers or bodies
      expect(request?.data).not.toHaveProperty('requestHeaders');

      await fetch(`${app.url}/webhooks/psp`, { method: 'POST', body: '{}' });
      const [webhook] = await readEvents(reader, 1, buffer);
      expect(webhook).toMatchObject({
        event: 'webhook',
        data: { verifyResult: 'missing_header', responseStatus: 401 },
      });
      expect(webhook?.data).not.toHaveProperty('body');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it('starts with retry: 3000', async () => {
    const controller = new AbortController();
    const res = await fetch(`${app.url}/api/stream`, { signal: controller.signal });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    controller.abort();
    expect(new TextDecoder().decode(value)).toMatch(/^retry: 3000\n\n/);
  });
});

describe('POST /api/invoices/{invoiceId}/checkout-link', () => {
  const link = (body?: unknown, invoiceId = INVOICE_ID): Promise<Response> =>
    fetch(`${app.url}/api/invoices/${invoiceId}/checkout-link`, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });

  it('builds the signed link offline (psp.checkout.createUrl), with no platform call', async () => {
    stub.answer({ status: 500, body: {} });
    const before = Math.floor(Date.now() / 1000);
    const res = await link({
      branding: { companyName: 'My Shop', theme: 'dark' },
      locale: 'en',
      expiresInSeconds: 600,
    });
    expect(res.status).toBe(200);
    const { url, token, expiresAt } = (await res.json()) as { url: string; token: string; expiresAt: string };
    expect(url).toBe(`${CHECKOUT_URL}/#${token}`);

    // gateway docs 20.2: v1.<base64url payload>.<base64url HMAC-SHA256(secret, "psp-checkout-v1." + payload)>
    const [version, payload = '', signature] = token.split('.');
    expect(version).toBe('v1');
    expect(signature).toBe(createHmac('sha256', API_SECRET).update(`psp-checkout-v1.${payload}`).digest('base64url'));
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ k: API_KEY, i: INVOICE_ID, b: { companyName: 'My Shop', theme: 'dark' }, l: 'en' });
    expect(claims['e']).toBeGreaterThanOrEqual(before + 600);
    expect(new Date(expiresAt).getTime() / 1000).toBe(claims['e']);
    expect(stub.requests).toHaveLength(0);
    expect(res.headers.get('x-example-call-id')).toBeNull();
  });

  it('works without a body (24 h)', async () => {
    const res = await link();
    expect(res.status).toBe(200);
  });

  it.each([
    ['an expiry over 7 days', { expiresInSeconds: 604801 }],
    ['a locale', { locale: 'de' }],
    ['a branding key', { branding: { font: 'x' } }],
    ['a colour', { branding: { accentColor: 'red' } }],
    ['an http logo', { branding: { logoUrl: 'http://shop.test/logo.png' } }],
    ['branding null', { branding: null }],
    ['an option', { theme: 'dark' }],
    ['a body', [1]],
  ])('refuses %s with 400 example_invalid_request', async (_name, body) => {
    const res = await link(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      errorCode: 'example_invalid_request',
      details: { field: expect.any(String) },
    });
  });

  it('refuses an invoice id that is not a lower-case uuid', async () => {
    expect((await link(undefined, INVOICE_ID.toUpperCase())).status).toBe(400);
  });
});

describe('APP_UI_DIR', () => {
  it('serves the UI with an SPA fallback, and the API next to it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdk-api-ui-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ui</title>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    const withUi = await startApp(testEnv(stub.url, { APP_UI_DIR: dir }));
    try {
      expect(await (await fetch(`${withUi.url}/`)).text()).toContain('<title>ui</title>');
      expect(await (await fetch(`${withUi.url}/invoices/123`)).text()).toContain('<title>ui</title>');
      expect(await (await fetch(`${withUi.url}/app.js`)).text()).toBe('console.log(1)');
      const api = await fetch(`${withUi.url}/api/unknown`);
      expect(api.status).toBe(404);
      expect(await api.json()).toMatchObject({ errorCode: 'example_not_found' });
      expect((await fetch(`${withUi.url}/api/config`)).status).toBe(200);
    } finally {
      await withUi.close();
    }
  });
});
