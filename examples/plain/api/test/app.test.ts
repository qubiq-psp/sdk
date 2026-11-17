import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigView, ExampleError } from '../src/types.ts';
import { signWebhook } from '../src/webhook-verify.ts';
import { makeApp, OTHER_SECRET, SHOP_KEY, SHOP_SECRET, startStubPlatform, type StubPlatform } from './helpers.ts';

let stub: StubPlatform;
beforeAll(async () => {
  stub = await startStubPlatform();
});
afterAll(async () => {
  await stub.close();
});

describe('GET /api/config', () => {
  it('describes the deployment without any part of the secret', async () => {
    const { app } = await makeApp({ PSP_API_PREVIOUS_SECRET: OTHER_SECRET });
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    const config = res.json<ConfigView>();
    expect(config).toEqual({
      backend: 'plain',
      version: '0.1.0',
      sdkVersion: null,
      net: 'testnet',
      apiUrl: 'http://127.0.0.1:4000',
      keyId: SHOP_KEY,
      previousSecretSet: true,
      checkoutUrl: 'https://pay.psp.qubiq.cc',
      webhookUrl: 'https://plain-example.example.com/webhooks/psp',
      serverTime: config.serverTime,
    });
    expect(Math.abs(Date.parse(config.serverTime) - Date.now())).toBeLessThan(5000);
    for (const secret of [SHOP_SECRET, OTHER_SECRET]) {
      expect(res.body).not.toContain(secret.slice(7));
      expect(res.body).not.toContain(secret.slice(-12));
    }
  });

  it('webhookUrl is null without APP_PUBLIC_URL', async () => {
    const { app } = await makeApp({ APP_PUBLIC_URL: '' });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json<ConfigView>().webhookUrl).toBeNull();
  });
});

describe('the secret never leaves', () => {
  it('not in the server log, the request log, the answers or errors', async () => {
    const lines: string[] = [];
    const { app } = await makeApp(
      { PSP_API_URL: stub.url, PSP_API_PREVIOUS_SECRET: OTHER_SECRET, LOG_LEVEL: 'trace' },
      { logger: { write: (line) => lines.push(line) } },
    );
    const bodies: string[] = [];
    const call = async (method: 'GET' | 'POST', url: string, payload?: string) => {
      const res = await app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload, headers: { 'content-type': 'application/json' } }),
      });
      bodies.push(res.body);
      return res;
    };
    await call('POST', '/api/invoices', '{"a":1}');
    await call('POST', '/api/invoices', '{bad');
    const ts = String(Math.floor(Date.now() / 1000));
    await app.inject({
      method: 'POST',
      url: '/webhooks/psp',
      headers: { 'x-webhook-timestamp': ts, 'x-webhook-signature': signWebhook(SHOP_SECRET, ts, Buffer.from('{}')) },
      payload: '{}',
    });
    for (const url of ['/api/config', '/api/request-log', '/api/received-webhooks']) await call('GET', url);
    const logId = (JSON.parse(bodies[3]!) as { items: { id: string }[] }).items[0]!.id;
    const hookId = (JSON.parse(bodies[4]!) as { items: { id: string }[] }).items[0]!.id;
    await call('GET', `/api/request-log/${logId}`);
    await call('GET', `/api/received-webhooks/${hookId}`);
    const everything = [...lines, ...bodies].join('\n');
    for (const secret of [SHOP_SECRET, OTHER_SECRET]) expect(everything).not.toContain(secret);
  });
});

describe('GET /api/stream', () => {
  it('ready, then request and webhook events with ids; headers for proxies', async () => {
    const { app } = await makeApp({ PSP_API_URL: stub.url });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const ctrl = new AbortController();
    try {
      const res = await fetch(`${address}/api/stream`, { signal: ctrl.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-accel-buffering')).toBe('no');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let text = '';
      const readUntil = async (marker: string) => {
        while (!text.includes(marker)) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      };
      await readUntil('event: ready');
      await fetch(`${address}/api/account`, { headers: { 'x-example-source': 'poll' } });
      const ts = String(Math.floor(Date.now() / 1000));
      await fetch(`${address}/webhooks/psp`, { method: 'POST', body: '{}', headers: { 'x-webhook-timestamp': ts } });
      await readUntil('event: webhook');

      const events = text.split('\n\n').filter(Boolean);
      expect(events[0]).toBe('retry: 3000');
      expect(events[1]).toMatch(/^event: ready\ndata: \{"backend":"plain","serverTime":"[^"]+"\}$/);
      const request = /^event: request\nid: ([0-9a-f-]{36})\ndata: (.+)$/.exec(events[2] ?? '');
      expect(request).not.toBeNull();
      expect(JSON.parse(request![2]!)).toMatchObject({ id: request![1], operationId: 'getAccount', source: 'poll' });
      expect(JSON.parse(request![2]!)).not.toHaveProperty('requestHeaders');
      const webhook = /^event: webhook\nid: ([0-9a-f-]{36})\ndata: (.+)$/.exec(events[3] ?? '');
      expect(JSON.parse(webhook![2]!)).toMatchObject({ id: webhook![1], verifyResult: 'missing_header' });
      expect(JSON.parse(webhook![2]!)).not.toHaveProperty('body');
    } finally {
      ctrl.abort();
      await app.close();
    }
  });
});

describe('the built UI (APP_UI_DIR)', () => {
  function uiDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'plain-ui-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ui</title>');
    writeFileSync(join(dir, 'assets', 'app-abc.js'), 'console.log(1)');
    return dir;
  }

  it('serves files, falls back to index.html for UI paths, keeps /api and /webhooks as 404', async () => {
    const { app } = await makeApp({ APP_UI_DIR: uiDir() });
    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    for (const url of ['/', '/invoices/97da92f5-45c0-411b-9ed5-6793b396cd5f']) {
      const page = await app.inject({ method: 'GET', url });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>ui</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
      const csp = String(page.headers['content-security-policy']).split('; ');
      expect(csp).toContain('frame-src https://pay.psp.qubiq.cc');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'self'");
    }
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).json()).toMatchObject({
      errorCode: 'example_not_found',
    });
    expect((await app.inject({ method: 'GET', url: '/webhooks/psp' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
  });

  it('never serves a file outside APP_UI_DIR (traversal, encoded separators, dotfiles)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'plain-ui-parent-'));
    writeFileSync(join(parent, 'secret.txt'), 'outside the UI');
    const dir = join(parent, 'ui');
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ui</title>');
    writeFileSync(join(dir, '.env'), 'PSP_API_SECRET=nope');
    const { app } = await makeApp({ APP_UI_DIR: dir });
    for (const url of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '//secret.txt',
      '/.env',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('outside the UI');
      expect(res.body, url).not.toContain('PSP_API_SECRET');
    }
  });

  it('without APP_UI_DIR answers the API only', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ errorCode: 'example_not_found' });
  });
});

describe('no SDK', () => {
  // Comments may name the SDK (to compare with it); code may not import it
  const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]@qubiq-psp\//;

  it('the import check catches every form', () => {
    for (const code of [
      "import { PspClient } from '@qubiq-psp/sdk';",
      'import type { X } from "@qubiq-psp/sdk";',
      "import '@qubiq-psp/sdk';",
      "await import('@qubiq-psp/react')",
      "require('@qubiq-psp/sdk')",
      "export * from '@qubiq-psp/sdk';",
    ]) {
      expect(IMPORT_RE.test(code), code).toBe(true);
    }
    expect(IMPORT_RE.test('// the reasons of verifyWebhook() of @qubiq-psp/sdk')).toBe(false);
  });

  it('nothing in src imports @qubiq-psp/*, and package.json does not depend on it', () => {
    const src = new URL('../src/', import.meta.url);
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((file) =>
      /\.[cm]?[jt]sx?$/.test(file),
    );
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((file) => IMPORT_RE.test(readFileSync(new URL(file, src), 'utf8')));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;
    const deps = Object.keys({ ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) });
    expect(deps.filter((name) => name.startsWith('@qubiq-psp/'))).toEqual([]);
  });
});

describe('cross-site requests to /api (CSRF: basic auth is ambient)', () => {
  const body = '{"externalId":"x"}';
  const json = { 'content-type': 'application/json' };

  it('403 example_forbidden for a foreign Origin or Sec-Fetch-Site on POST/PUT/DELETE, before any platform call', async () => {
    const { app, log } = await makeApp();
    const cases: [string, string, Record<string, string>, string][] = [
      ['POST', '/api/invoices', { origin: 'https://evil.example' }, 'Origin'],
      ['POST', '/api/invoices', { origin: 'null' }, 'Origin'],
      ['POST', '/api/invoices', { origin: 'http://localhost:80' }, 'Origin'],
      ['PUT', '/api/receiver', { 'sec-fetch-site': 'cross-site' }, 'Sec-Fetch-Site'],
      ['DELETE', '/api/request-log', { 'sec-fetch-site': 'same-site' }, 'Sec-Fetch-Site'],
    ];
    for (const [method, url, headers, header] of cases) {
      const res = await app.inject({
        method: method as 'POST',
        url,
        headers: { ...json, host: 'example.test', ...headers },
        payload: method === 'DELETE' ? undefined : body,
      });
      expect(res.statusCode, `${method} ${url} ${JSON.stringify(headers)}`).toBe(403);
      expect(res.json<ExampleError>()).toMatchObject({ errorCode: 'example_forbidden', details: { header } });
    }
    expect(log.page(() => true, 1, 50).total).toBe(0);
  });

  it('passes a same-origin browser request, one without Origin, and any GET', async () => {
    const { app } = await makeApp();
    const settings = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };
    for (const headers of [
      { host: 'example.test', origin: 'https://example.test', 'sec-fetch-site': 'same-origin' },
      { host: 'example.test:8443', origin: 'https://Example.test:8443' },
      { host: 'example.test', 'sec-fetch-site': 'none' },
      { host: 'example.test' },
    ]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/receiver',
        headers: { ...json, ...headers },
        payload: settings,
      });
      expect(res.statusCode, JSON.stringify(headers)).toBe(200);
    }
    const get = await app.inject({ method: 'GET', url: '/api/config', headers: { origin: 'https://evil.example' } });
    expect(get.statusCode).toBe(200);
  });

  it('a body must be application/json: 400 example_invalid_request, field Content-Type', async () => {
    const { app } = await makeApp();
    for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/receiver',
        headers: contentType === undefined ? {} : { 'content-type': contentType },
        payload: Buffer.from('{"mode":"fixed","status":500,"delayMs":0,"failNext":0}'),
      });
      expect(res.statusCode, String(contentType)).toBe(400);
      expect(res.json<ExampleError>()).toMatchObject({ details: { field: 'Content-Type' } });
    }
    const empty = await app.inject({
      method: 'DELETE',
      url: '/api/request-log',
      headers: { 'content-type': 'text/plain' },
    });
    expect(empty.statusCode).toBe(204);
  });
});
