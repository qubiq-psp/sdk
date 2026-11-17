// GET /api/stream — Server-Sent Events (examples/contract/README.md, "SSE stream"): `ready` once, then `request` for
// every new request-log entry and `webhook` for every received webhook. A `: ping` comment every 20 s keeps proxies
// from closing the connection (nginx needs `proxy_buffering off` here). No replay: after a reconnect the UI refetches.
import type { FastifyInstance } from 'fastify';
import type { EventBus } from './bus.ts';

export const PING_INTERVAL_MS = 20_000;

export function registerStream(app: FastifyInstance, { bus }: { bus: EventBus }): void {
  const open = new Set<() => void>();
  // Open streams would keep the server from closing
  app.addHook('preClose', async () => {
    for (const close of open) close();
  });

  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ backend: 'plain', serverTime: new Date().toISOString() })}\n\n`);
    const unsubscribe = bus.subscribe((event) => {
      res.write(`event: ${event.type}\nid: ${event.item.id}\ndata: ${JSON.stringify(event.item)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);
    const close = () => {
      clearInterval(ping);
      unsubscribe();
      open.delete(close);
      res.end();
    };
    open.add(close);
    req.raw.on('close', close);
  });
}
