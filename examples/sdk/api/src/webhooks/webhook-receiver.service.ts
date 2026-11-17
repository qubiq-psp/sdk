// The webhook receiver. The merchant part is three steps (SDK README, «Rules of a robust handler»):
//   1. verify the raw body bytes with psp.webhook.verify() — signature, ±300 s window, body ↔ headers, network;
//   2. drop a duplicate by the webhook id — delivery is at least once, retries and redeliveries carry the same id;
//   3. store it and answer 2xx at once (within 10 s), process after the answer.
// The rest is example plumbing for QA: every request is logged with the details of its verification, and the answer
// can be forced (`ReceiverSettings`) to produce retries, failed deliveries and redeliveries on purpose.
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { components } from '@psp-examples/contract/types';
import { PspClient, WebhookVerificationError, signWebhook, type WebhookEvent } from '@qubiq-psp/sdk';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RUNTIME, type Runtime } from '../config/config.module';
import { BoundedLog } from '../example/bounded-log';
import { ExampleError, pageParams, stringParam } from '../example/example-error';

export type ReceivedWebhook = components['schemas']['ReceivedWebhook'];
export type ReceivedWebhookItem = components['schemas']['ReceivedWebhookItem'];
export type ReceivedWebhookPage = components['schemas']['ReceivedWebhookPage'];
export type ReceiverSettings = components['schemas']['ReceiverSettings'];
type VerifyResult = components['schemas']['WebhookVerifyResult'];

/** What the controller answers, after `delayMs`. */
export interface ReceiverAnswer {
  status: number;
  body: Record<string, unknown>;
  delayMs: number;
}

const DEFAULT_SETTINGS: ReceiverSettings = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };
/** Webhook ids remembered for the duplicate check. A shop keeps them in a table with a unique key. */
const MAX_ACCEPTED_IDS = 10_000;

@Injectable()
export class WebhookReceiverService {
  readonly #logger = new Logger('Webhooks');
  readonly #log: BoundedLog<ReceivedWebhook>;
  /** Ids of webhooks already accepted with 2xx, oldest first. */
  readonly #accepted = new Set<string>();
  #settings: ReceiverSettings = { ...DEFAULT_SETTINGS };
  private readonly now: () => number;

  constructor(
    @Inject(PspClient) private readonly psp: PspClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RUNTIME) runtime: Runtime,
  ) {
    this.#log = new BoundedLog(config.logLimit);
    this.now = runtime.now ?? Date.now;
  }

  /** Verifies, logs and decides the answer to one request to `POST /webhooks/psp`. */
  receive(rawBody: Buffer, rawHeaders: IncomingHttpHeaders, remoteIp: string | null): ReceiverAnswer {
    const headers = flatHeaders(rawHeaders);
    const now = new Date(this.now());

    // 1. Verify the raw bytes, before any JSON parsing. The client verifies with PSP_API_SECRET and, during a
    //    rotation, PSP_API_PREVIOUS_SECRET. No expectedMerchantId here: one key, one merchant.
    let event: WebhookEvent | null = null;
    let result: VerifyResult = 'ok';
    let message = 'The webhook is valid';
    let refusal = 401;
    try {
      event = this.psp.webhook.verify(rawBody, headers, { now });
    } catch (err) {
      if (!(err instanceof WebhookVerificationError) || err.reason === 'merchant_mismatch') throw err;
      result = err.reason;
      message = err.message;
      refusal = err.status;
    }

    // 2. A duplicate: the same webhook id accepted before (a retry or a redelivery)
    const webhookId = headers['x-webhook-id'] ?? null;
    const duplicate = event !== null && this.#accepted.has(event.id);

    // 3. The answer: 2xx for a valid webhook (also a duplicate), the SDK's status otherwise — unless QA forced one
    const settings = this.#settings;
    let status: number;
    let body: Record<string, unknown>;
    if (settings.failNext > 0) {
      settings.failNext -= 1;
      status = settings.status;
      body = { forced: 'fail_next' };
    } else if (settings.mode === 'fixed') {
      status = settings.status;
      body = { forced: 'fixed' };
    } else if (event !== null) {
      status = 200;
      body = { received: true, duplicate };
    } else {
      status = refusal;
      body = { errorCode: result, errorMessage: message };
    }
    if (event !== null && status >= 200 && status < 300) this.remember(event.id);
    if (event !== null && !duplicate && status >= 200 && status < 300) {
      // A shop stores the event here (in the same transaction as the id) and processes it after answering
      this.#logger.log(`${event.type} ${event.id}: accepted`);
    }

    const entry = this.logEntry({
      rawBody,
      headers,
      remoteIp,
      now,
      result,
      message,
      duplicate,
      status,
      body,
      webhookId,
    });
    this.#log.add(entry);
    return { status, body, delayMs: settings.delayMs };
  }

  list(query: Readonly<Record<string, unknown>>): ReceivedWebhookPage {
    const { page, limit } = pageParams(query);
    const invoiceId = stringParam(query, 'invoiceId');
    const webhookId = stringParam(query, 'webhookId');
    const event = stringParam(query, 'event');
    const result = stringParam(query, 'result', ['ok', 'failed'] as const);
    const found = this.#log.page(
      (entry) =>
        (invoiceId === undefined || entry.invoiceId === invoiceId) &&
        (webhookId === undefined || entry.webhookId === webhookId) &&
        (event === undefined || entry.event === event) &&
        (result === undefined || (entry.verifyResult === 'ok') === (result === 'ok')),
      page,
      limit,
    );
    return { items: found.items.map(toItem), page, limit, total: found.total };
  }

  get(id: string): ReceivedWebhook {
    const entry = this.#log.get(id);
    if (!entry) throw ExampleError.notFound('No such received webhook (a restart clears the log)');
    return entry;
  }

  /** Clears the log and the duplicate memory. */
  clear(): void {
    this.#log.clear();
    this.#accepted.clear();
  }

  subscribe(listener: (item: ReceivedWebhookItem) => void): () => void {
    return this.#log.subscribe((entry) => {
      listener(toItem(entry));
    });
  }

  getSettings(): ReceiverSettings {
    return { ...this.#settings };
  }

  setSettings(input: unknown): ReceiverSettings {
    this.#settings = parseSettings(input);
    return this.getSettings();
  }

  private remember(id: string): void {
    this.#accepted.delete(id);
    this.#accepted.add(id);
    if (this.#accepted.size > MAX_ACCEPTED_IDS) {
      const oldest = this.#accepted.values().next().value;
      if (oldest !== undefined) this.#accepted.delete(oldest);
    }
  }

  /** The log entry, with what QA needs to see why a webhook passed or failed. */
  private logEntry(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    remoteIp: string | null;
    now: Date;
    result: VerifyResult;
    message: string;
    duplicate: boolean;
    status: number;
    body: Record<string, unknown>;
    webhookId: string | null;
  }): ReceivedWebhook {
    const { rawBody, headers, now } = input;
    const timestampHeader = headers['x-webhook-timestamp'];
    const timestamp =
      timestampHeader !== undefined && /^\d{1,12}$/.test(timestampHeader) ? Number(timestampHeader) : null;
    // signatureValid and signedWith are checked on their own, so they show even when another step failed (the window)
    const received = headers['x-webhook-signature'];
    const signedBy = (secret: string | undefined): boolean =>
      secret !== undefined &&
      timestampHeader !== undefined &&
      signWebhook(secret, timestampHeader, rawBody) === received;
    const signedWith = signedBy(this.config.psp.apiSecret)
      ? 'current'
      : signedBy(this.config.psp.previousApiSecret)
        ? 'previous'
        : null;

    const text = rawBody.toString('utf8');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const invoice = invoiceOf(json);
    const attemptHeader = headers['x-webhook-attempt'];

    return {
      id: randomUUID(),
      receivedAt: now.toISOString(),
      webhookId: input.webhookId,
      event: headers['x-webhook-event'] ?? null,
      attempt: attemptHeader !== undefined && /^\d{1,9}$/.test(attemptHeader) ? Number(attemptHeader) : null,
      invoiceId: invoice.id,
      externalId: invoice.externalId,
      invoiceStatus: invoice.status,
      verifyResult: input.result,
      signedWith,
      duplicate: input.duplicate,
      responseStatus: input.status,
      responseDelayMs: this.#settings.delayMs,
      remoteIp: input.remoteIp,
      headers,
      body: text,
      json,
      verify: {
        result: input.result,
        message: input.message,
        timestamp,
        skewSeconds: timestamp === null ? null : Math.floor(now.getTime() / 1000) - timestamp,
        signatureValid: signedWith !== null,
        // signWebhook() of the SDK: what the platform should have sent, signed with the current secret
        expectedSignature:
          timestampHeader === undefined ? null : signWebhook(this.config.psp.apiSecret, timestampHeader, rawBody),
        bodyBytes: rawBody.length,
      },
      responseBody: JSON.stringify(input.body),
    };
  }
}

function toItem(entry: ReceivedWebhook): ReceivedWebhookItem {
  const {
    remoteIp: _remoteIp,
    headers: _headers,
    body: _body,
    json: _json,
    verify: _verify,
    responseBody: _responseBody,
    ...item
  } = entry;
  return item;
}

/** Header names in lower case, a repeated header joined with `, `. */
function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

function invoiceOf(json: unknown): { id: string | null; externalId: string | null; status: string | null } {
  const child = (value: unknown, name: string): unknown =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[name] : undefined;
  const invoice = child(child(json, 'data'), 'invoice');
  const field = (name: string): string | null => {
    const value = child(invoice, name);
    return typeof value === 'string' ? value : null;
  };
  return { id: field('id'), externalId: field('externalId'), status: field('status') };
}

function parseSettings(input: unknown): ReceiverSettings {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw ExampleError.invalid('body', 'must be an object { mode, status, delayMs, failNext }');
  }
  const body = input as Record<string, unknown>;
  const extra = Object.keys(body).find((key) => !(key in DEFAULT_SETTINGS));
  if (extra !== undefined) throw ExampleError.invalid(extra, 'is not a receiver setting');
  const int = (name: string, min: number, max: number): number => {
    const value = body[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw ExampleError.invalid(name, `must be an integer from ${min} to ${max}`);
    }
    return value;
  };
  if (body['mode'] !== 'auto' && body['mode'] !== 'fixed') throw ExampleError.invalid('mode', 'must be auto or fixed');
  return {
    mode: body['mode'],
    status: int('status', 200, 599),
    delayMs: int('delayMs', 0, 30_000),
    failNext: int('failNext', 0, 100),
  };
}
