// A tiny local stub of the Merchant API: a real HTTP server on 127.0.0.1 that records what it received and answers
// what the test queued (the full fake gateway of examples/contract comes later).
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubRequest {
  method: string;
  /** Path and query as received, e.g. `/api/v1/invoices?status=active,paid`. */
  target: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface StubAnswer {
  status: number;
  headers?: Record<string, string>;
  /** An object is sent as JSON; a string as is. */
  body?: unknown;
}

export class PlatformStub {
  readonly requests: StubRequest[] = [];
  /** Answers in order; the last one repeats when the queue runs out. */
  #answers: StubAnswer[] = [];
  #server: Server | undefined;
  url = '';

  async start(): Promise<this> {
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        this.requests.push({
          method: req.method ?? '',
          target: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const answer = (this.#answers.length > 1 ? this.#answers.shift() : this.#answers[0]) ?? {
          status: 200,
          body: { ok: true },
        };
        const json = typeof answer.body !== 'string' && answer.body !== undefined;
        res.writeHead(answer.status, {
          ...(json ? { 'Content-Type': 'application/json' } : {}),
          'X-Request-Id': `req-${this.requests.length}`,
          ...answer.headers,
        });
        res.end(json ? JSON.stringify(answer.body) : ((answer.body as string | undefined) ?? ''));
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this;
  }

  /** Queues the answers of the next requests and forgets the recorded ones. */
  answer(...answers: StubAnswer[]): void {
    this.#answers = answers;
    this.requests.length = 0;
  }

  async stop(): Promise<void> {
    this.#server?.closeAllConnections();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
}
