// HTTP helpers of the conformance suite: one call to a backend, and an SSE reader.

export interface Answer {
  status: number;
  headers: Headers;
  contentType: string;
  text: string;
  /** The body parsed as JSON; undefined when it is not JSON. */
  json: unknown;
  /** `X-Example-Call-Id`, or null. */
  callId: string | null;
}

export interface CallInit {
  method?: string;
  /** JSON body (serialised here) — or `raw` for bytes as they are. */
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
}

export async function request(baseUrl: string, path: string, init: CallInit = {}): Promise<Answer> {
  const headers: Record<string, string> = { accept: 'application/json, text/csv', ...init.headers };
  let body: string | undefined;
  if (init.raw !== undefined) {
    body = init.raw;
    headers['content-type'] ??= 'application/json';
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(new URL(path, baseUrl), { method: init.method ?? 'GET', headers, body, redirect: 'manual' });
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  let json: unknown;
  if (/json/i.test(contentType) && text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return {
    status: res.status,
    headers: res.headers,
    contentType,
    text,
    json,
    callId: res.headers.get('x-example-call-id'),
  };
}

export interface SseEvent {
  event: string;
  id: string | null;
  data: string;
}

/** An open `text/event-stream`: events are collected as they arrive. */
export interface SseStream {
  status: number;
  headers: Headers;
  events: SseEvent[];
  /** Resolves with the first collected (or future) event matching the predicate. */
  waitFor(predicate: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
  close(): void;
}

export async function openSse(url: string): Promise<SseStream> {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
  const events: SseEvent[] = [];
  const waiters: { predicate: (e: SseEvent) => boolean; resolve: (e: SseEvent) => void }[] = [];
  const push = (e: SseEvent): void => {
    events.push(e);
    for (const w of [...waiters]) {
      if (w.predicate(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  };
  if (res.body) {
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let event = 'message';
            let id: string | null = null;
            const data: string[] = [];
            let any = false;
            for (const line of block.split('\n')) {
              if (line === '' || line.startsWith(':')) continue;
              const colon = line.indexOf(':');
              const field = colon < 0 ? line : line.slice(0, colon);
              const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
              if (field === 'event') event = value;
              else if (field === 'id') id = value;
              else if (field === 'data') data.push(value);
              else continue;
              any = true;
            }
            if (any && data.length) push({ event, id, data: data.join('\n') });
          }
        }
      } catch {
        // closed
      }
    })();
  }
  return {
    status: res.status,
    headers: res.headers,
    events,
    waitFor(predicate, timeoutMs = 5000) {
      const found = events.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (e: SseEvent) => {
            clearTimeout(timer);
            resolve(e);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`no matching SSE event in ${timeoutMs} ms; got: ${events.map((e) => e.event).join(', ')}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    close: () => controller.abort(),
  };
}
