// The Fastify application: the contract routes of examples/contract/openapi.yaml and, optionally, the built UI.
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { EventBus } from './bus.ts';
import { CheckoutInputError, createCheckoutLink } from './checkout.ts';
import { loadConfig, type Config } from './config.ts';
import { invalidRequest, notFound, registerErrorHandler } from './errors.ts';
import { API_BODY_LIMIT } from './limits.ts';
import { assignCallId, registerPassthrough } from './passthrough.ts';
import { Receiver, registerReceiver } from './receiver.ts';
import { RequestLog, registerRequestLogRoutes } from './request-log.ts';
import { refusalOf } from './same-origin.ts';
import { registerStream } from './stream.ts';
import type { CheckoutLinkView, ConfigView } from './types.ts';
import { VERSION } from './version.ts';

const INVOICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Headers of the UI pages: scripts only from this origin, frames only of the payment page, never framed itself. */
function uiHeaders(config: Config): Record<string, string> {
  return {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      `font-src 'self'; connect-src 'self'; frame-src ${config.checkoutUrl}; object-src 'none'; base-uri 'none'; ` +
      "form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
}

export interface AppOptions {
  config: Config;
  /** `false` — no logs (tests); a stream — logs into it. */
  logger?: boolean | { write(line: string): void };
  /** `fetch` for the platform calls — tests pass a stub. */
  fetch?: typeof fetch;
}

export async function buildApp({ config, logger = true, fetch: fetchImpl = fetch }: AppOptions) {
  const app: FastifyInstance = Fastify({
    logger: logger === false ? false : { level: config.logLevel, ...(logger === true ? {} : { stream: logger }) },
    // nginx runs on the same host: the client IP is taken from X-Forwarded-For of loopback only
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: API_BODY_LIMIT,
  });
  registerErrorHandler(app);
  // Before routing to a handler or parsing a body: the call id of a passthrough call, then the cross-site checks
  app.addHook('onRequest', async (req, reply) => {
    assignCallId(req, reply);
    const path = req.url.split('?')[0] ?? '';
    if (path === '/api' || path.startsWith('/api/')) {
      const refusal = refusalOf(req.method, req.headers);
      if (refusal) throw refusal;
    }
  });

  const bus = new EventBus();
  const log = new RequestLog(config.logLimit, config.logMaxBytes, bus);
  const receiver = new Receiver(config.logLimit, config.logMaxBytes);

  app.get('/api/config', async (): Promise<ConfigView> => ({
    backend: 'plain',
    version: VERSION,
    sdkVersion: null,
    net: config.net,
    apiUrl: config.apiUrl,
    keyId: config.apiKey,
    previousSecretSet: config.previousApiSecret !== null,
    checkoutUrl: config.checkoutUrl,
    webhookUrl: config.webhookUrl,
    serverTime: new Date().toISOString(),
  }));

  // The payment widget link: built offline with the secret, no platform call and no request-log entry
  app.post('/api/invoices/:invoiceId/checkout-link', async (req): Promise<CheckoutLinkView> => {
    const { invoiceId } = req.params as { invoiceId: string };
    if (!INVOICE_ID_RE.test(invoiceId)) throw invalidRequest('invoiceId', 'must be a lower-case uuid');
    try {
      const link = createCheckoutLink(
        config.checkoutUrl,
        { apiKey: config.apiKey, apiSecret: config.apiSecret },
        invoiceId,
        req.body ?? {},
      );
      // Neither the secret nor the token: whoever has the token sees the invoice
      req.log.info({ invoiceId, expiresAt: link.expiresAt }, 'checkout link built');
      return link;
    } catch (err) {
      if (err instanceof CheckoutInputError) throw invalidRequest(err.field, err.message.replace(`${err.field}: `, ''));
      throw err;
    }
  });

  registerRequestLogRoutes(app, { log });
  registerStream(app, { bus });
  await registerReceiver(app, { config, receiver, bus });
  await registerPassthrough(app, { config, log, fetch: fetchImpl });

  // The built UI, if any: its files, and index.html for every other GET outside /api and /webhooks (SPA routes)
  const headers = uiHeaders(config);
  if (config.uiDir) {
    await app.register(fastifyStatic, {
      root: config.uiDir,
      wildcard: true,
      cacheControl: false, // set below
      index: ['index.html'],
      // @fastify/static serves dotfiles by default ('allow'); a UI folder has none to serve
      dotfiles: 'ignore',
      // @fastify/static 10: a FastifyReply, and these headers win over the ones the file sender sets
      setHeaders: (reply, path) => {
        void reply.headers(headers);
        void reply.header(
          'Cache-Control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const backendPath = ['/api/', '/webhooks/', '/assets/'].some((p) => path.startsWith(p)) || path === '/api';
    if (!config.uiDir || req.method !== 'GET' || backendPath) {
      const error = notFound(`No route ${req.method} ${path}`);
      return reply.status(error.status).send(error.toBody());
    }
    for (const [k, v] of Object.entries(headers)) void reply.header(k, v);
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  return { app, bus, log, receiver };
}

/**
 * Builds the app from an environment object — `process.env` in main.ts, a test's own object elsewhere, so several
 * instances can run in one process. Throws `ConfigError` on a wrong environment (e.g. a live key with
 * APP_TESTNET_ONLY=true).
 */
export async function createApp(env: NodeJS.ProcessEnv, options: Omit<AppOptions, 'config'> = {}) {
  const config = loadConfig(env);
  return { ...(await buildApp({ config, ...options })), config };
}
