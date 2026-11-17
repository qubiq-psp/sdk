// Test helpers: the made-up credentials of the docs' vectors, a config, the app, and a tiny local stub of the platform
// that checks signatures with its own code (not src/signer.ts). The full fake gateway comes with the conformance suite.
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp, type AppOptions } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';

// The made-up `shop-example` key and secret of gateway docs 13.5 (published on purpose)
export const SHOP_KEY = 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
export const SHOP_SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
/** The secret with the last character changed — the negative rows of the docs. */
export const WRONG_SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4M';
export const OTHER_SECRET = 'psp_sk_Hq3vN8xK1mT6wR4cZ9bL2fJ7dY5gA0sEp6Wt';

export const BASE_ENV = {
  PSP_API_URL: 'http://127.0.0.1:4000',
  PSP_API_KEY: SHOP_KEY,
  PSP_API_SECRET: SHOP_SECRET,
  PSP_CHECKOUT_URL: 'https://pay.psp.qubiq.cc',
  APP_PUBLIC_URL: 'https://plain-example.example.com',
};

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ ...BASE_ENV, ...env });
}

export async function makeApp(env: Record<string, string> = {}, options: Omit<AppOptions, 'config'> = {}) {
  const config = testConfig(env);
  const built = await buildApp({ config, logger: false, ...options });
  return { ...built, config };
}

export interface StubRequest {
  method: string;
  /** The raw request-target as it arrived. */
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
  /** Whether the signature is right, checked by the stub's own code. */
  signatureOk: boolean;
  stringToSign: string;
}

export interface StubAnswer {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  /** Wait before answering, ms. */
  delayMs?: number;
}

/** A tiny platform: checks the signature, then answers with `handler` (default: 200 and the request echoed). */
export async function startStubPlatform(secret = SHOP_SECRET) {
  const seen: StubRequest[] = [];
  let handler: (req: StubRequest) => StubAnswer = (req) => ({
    status: 200,
    body: JSON.stringify({ method: req.method, url: req.url }),
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const h = (name: string) => String(req.headers[name] ?? '');
      const stringToSign = [
        'v1',
        req.method ?? '',
        req.url ?? '',
        h('x-api-timestamp'),
        h('x-api-nonce'),
        createHash('sha256').update(body).digest('hex'),
      ].join('\n');
      const expected = `v1=${createHmac('sha256', secret).update(stringToSign).digest('hex')}`;
      const request: StubRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
        signatureOk: h('x-api-key') === SHOP_KEY && h('x-api-signature') === expected,
        stringToSign,
      };
      seen.push(request);
      const answer: StubAnswer = request.signatureOk
        ? handler(request)
        : {
            status: 401,
            body: JSON.stringify({
              errorCode: 'api_auth_failed',
              errorMessage: 'Request signature does not match',
              details: { reason: 'bad_signature', stringToSign },
            }),
          };
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(answer.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Request-Id': '11111111-2222-4333-8444-555555555555',
          ...(req.headers['x-client-request-id'] ? { 'X-Client-Request-Id': h('x-client-request-id') } : {}),
          ...answer.headers,
        });
        res.end(answer.body ?? '');
      };
      if (answer.delayMs) setTimeout(send, answer.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    answer(next: (req: StubRequest) => StubAnswer) {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type StubPlatform = Awaited<ReturnType<typeof startStubPlatform>>;
