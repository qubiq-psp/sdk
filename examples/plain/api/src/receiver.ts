// The webhook receiver `POST /webhooks/psp`, its log and its behaviour (examples/contract/README.md, "Webhook
// receiver"). The verification itself is in webhook-verify.ts; this file adds what QA needs: a log of every request,
// duplicates by X-Webhook-Id, and answers on demand (fixed status, fail the next N, a delay) to produce platform
// retries, `failed` deliveries and redeliveries.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EventBus } from './bus.ts';
import type { Config } from './config.ts';
import { invalidRequest, notFound } from './errors.ts';
import { MemoryLog } from './memory-log.ts';
import { pageParams, singleQuery } from './request-log.ts';
import type { ReceivedWebhook, ReceivedWebhookItem, ReceivedWebhookPage, ReceiverSettings } from './types.ts';
import { REFUSAL_STATUS, verifyWebhook } from './webhook-verify.ts';

/** The platform sends up to 64 KB; a receiver must accept at least that. */
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

export const DEFAULT_RECEIVER_SETTINGS: ReceiverSettings = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };

const ITEM_KEYS = [
  'id',
  'receivedAt',
  'webhookId',
  'event',
  'attempt',
  'invoiceId',
  'externalId',
  'invoiceStatus',
  'verifyResult',
  'signedWith',
  'duplicate',
  'responseStatus',
  'responseDelayMs',
] as const satisfies readonly (keyof ReceivedWebhookItem)[];

export const toWebhookItem = (webhook: ReceivedWebhook): ReceivedWebhookItem =>
  Object.fromEntries(ITEM_KEYS.map((key) => [key, webhook[key]])) as ReceivedWebhookItem;

/** Received webhooks in memory, the duplicate memory and the receiver settings. */
export class Receiver {
  readonly #log: MemoryLog<ReceivedWebhook>;
  /** `X-Webhook-Id`s of valid webhooks answered with 2xx, oldest first. */
  readonly #accepted = new Set<string>();
  readonly #limit: number;
  settings: ReceiverSettings = { ...DEFAULT_RECEIVER_SETTINGS };

  constructor(limit: number) {
    this.#log = new MemoryLog(limit);
    this.#limit = limit;
  }

  add(webhook: ReceivedWebhook): void {
    this.#log.add(webhook);
  }

  isDuplicate(webhookId: string): boolean {
    return this.#accepted.has(webhookId);
  }

  markAccepted(webhookId: string): void {
    this.#accepted.add(webhookId);
    // Remember about as many ids as there are log entries
    for (const id of this.#accepted) {
      if (this.#accepted.size <= this.#limit) break;
      this.#accepted.delete(id);
    }
  }

  get(id: string): ReceivedWebhook | undefined {
    return this.#log.get(id);
  }

  page(filter: (w: ReceivedWebhook) => boolean, page: number, limit: number) {
    return this.#log.page(filter, page, limit);
  }

  clear(): void {
    this.#log.clear();
    this.#accepted.clear();
  }
}

/** Checks a `PUT /api/receiver` body: every field, no other. */
export function parseReceiverSettings(body: unknown): ReceiverSettings {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw invalidRequest('body', 'must be an object');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!['mode', 'status', 'delayMs', 'failNext'].includes(key)) throw invalidRequest(key, 'is not supported');
  }
  const int = (name: string, min: number, max: number): number => {
    const value = input[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw invalidRequest(name, `must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  const mode = input['mode'];
  if (mode !== 'auto' && mode !== 'fixed') throw invalidRequest('mode', 'must be auto or fixed');
  return {
    mode,
    status: int('status', 200, 599),
    delayMs: int('delayMs', 0, 30_000),
    failNext: int('failNext', 0, 100),
  };
}

function invoiceOf(json: unknown): Pick<ReceivedWebhookItem, 'invoiceId' | 'externalId' | 'invoiceStatus'> {
  const invoice = (json as { data?: { invoice?: Record<string, unknown> } } | null)?.data?.invoice;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    invoiceId: str(invoice?.['id']),
    externalId: str(invoice?.['externalId']),
    invoiceStatus: str(invoice?.['status']),
  };
}

const flatHeaders = (headers: FastifyRequest['headers']): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v]])),
  );

const headerOf = (req: FastifyRequest, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ReceiverDeps {
  config: Config;
  receiver: Receiver;
  bus: EventBus;
}

export async function registerReceiver(app: FastifyInstance, { config, receiver, bus }: ReceiverDeps): Promise<void> {
  await app.register(async (scope) => {
    // The body is read as raw bytes before any JSON parsing, whatever the Content-Type: the signature is over them
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });

    scope.post('/webhooks/psp', async (req, reply) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const verify = verifyWebhook({
        headers: req.headers,
        body,
        secret: config.apiSecret,
        previousSecret: config.previousApiSecret,
      });
      const webhookId = headerOf(req, 'x-webhook-id');
      const rawAttempt = headerOf(req, 'x-webhook-attempt');
      const duplicate = verify.result === 'ok' && webhookId !== null && receiver.isDuplicate(webhookId);

      // The answer: failNext, then fixed, then by the verification
      const settings = receiver.settings;
      let status: number;
      let answer: Record<string, unknown>;
      if (settings.failNext > 0) {
        receiver.settings = { ...settings, failNext: settings.failNext - 1 };
        status = settings.status;
        answer = { forced: 'fail_next' };
      } else if (settings.mode === 'fixed') {
        status = settings.status;
        answer = { forced: 'fixed' };
      } else if (verify.result === 'ok') {
        status = 200;
        answer = { received: true, duplicate };
      } else {
        status = REFUSAL_STATUS[verify.result];
        answer = { errorCode: verify.result, errorMessage: verify.message };
      }
      if (verify.result === 'ok' && webhookId !== null && status >= 200 && status < 300) {
        receiver.markAccepted(webhookId);
      }

      const text = body.toString('utf8');
      let json: unknown = null;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        // not JSON: stored as text only
      }
      const responseBody = status === 204 || status === 304 ? null : JSON.stringify(answer);
      const webhook: ReceivedWebhook = {
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
        webhookId,
        event: headerOf(req, 'x-webhook-event'),
        attempt: rawAttempt !== null && /^\d{1,9}$/.test(rawAttempt) ? Number(rawAttempt) : null,
        ...invoiceOf(json),
        verifyResult: verify.result,
        signedWith: verify.signedWith,
        duplicate,
        responseStatus: status,
        responseDelayMs: settings.delayMs,
        remoteIp: req.ip,
        headers: flatHeaders(req.headers),
        body: text,
        json,
        verify: {
          result: verify.result,
          message: verify.message,
          timestamp: verify.timestamp,
          skewSeconds: verify.skewSeconds,
          signatureValid: verify.signatureValid,
          expectedSignature: verify.expectedSignature,
          bodyBytes: verify.bodyBytes,
        },
        responseBody,
      };
      // Stored and streamed before the answer, whatever the outcome
      receiver.add(webhook);
      bus.emit({ type: 'webhook', item: toWebhookItem(webhook) });
      req.log.info({ webhookId, event: webhook.event, verify: verify.result, status }, 'webhook received');

      if (settings.delayMs > 0) await sleep(settings.delayMs);
      return reply.status(status).send(responseBody === null ? undefined : answer);
    });
  });

  app.get('/api/received-webhooks', async (req): Promise<ReceivedWebhookPage> => {
    const q = singleQuery(req.query);
    const { page, limit } = pageParams(q);
    const { invoiceId, webhookId, event, result } = q;
    if (result !== undefined && result !== 'ok' && result !== 'failed')
      throw invalidRequest('result', 'must be ok or failed');
    const found = receiver.page(
      (w) =>
        (invoiceId === undefined || w.invoiceId === invoiceId) &&
        (webhookId === undefined || w.webhookId === webhookId) &&
        (event === undefined || w.event === event) &&
        (result === undefined || (result === 'ok') === (w.verifyResult === 'ok')),
      page,
      limit,
    );
    return { items: found.items.map(toWebhookItem), page, limit, total: found.total };
  });

  app.get('/api/received-webhooks/:receivedId', async (req): Promise<ReceivedWebhook> => {
    const { receivedId } = req.params as { receivedId: string };
    const webhook = receiver.get(receivedId);
    if (!webhook) throw notFound('No such received webhook (the log keeps the latest ones, in memory)');
    return webhook;
  });

  app.delete('/api/received-webhooks', async (_req, reply) => {
    receiver.clear();
    return reply.status(204).send();
  });

  app.get('/api/receiver', async (): Promise<ReceiverSettings> => receiver.settings);

  app.put('/api/receiver', async (req): Promise<ReceiverSettings> => {
    receiver.settings = parseReceiverSettings(req.body);
    return receiver.settings;
  });
}
