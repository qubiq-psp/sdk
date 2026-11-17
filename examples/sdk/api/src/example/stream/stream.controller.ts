// Example plumbing: `GET /api/stream` — Server-Sent Events of new request-log entries (`request`) and received
// webhooks (`webhook`). No replay: after a reconnect the UI refetches the lists.
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhookReceiverService } from '../../webhooks/webhook-receiver.service';
import { RequestLogService } from '../request-log/request-log.service';

/** A comment line every 20 s keeps proxies from closing an idle connection. */
export const PING_INTERVAL_MS = 20_000;

@Controller('api/stream')
export class StreamController {
  constructor(
    @Inject(RequestLogService) private readonly requestLog: RequestLogService,
    @Inject(WebhookReceiverService) private readonly receiver: WebhookReceiverService,
  ) {}

  @Get()
  stream(@Req() req: Request, @Res() res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    // nginx must not buffer the stream
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: unknown, id?: string): void => {
      // JSON.stringify gives one line: newlines inside strings are escaped
      res.write(`event: ${event}\n${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`);
    };
    res.write('retry: 3000\n\n');
    send('ready', { backend: 'sdk', serverTime: new Date().toISOString() });

    const unsubscribe = [
      this.requestLog.subscribe((item) => {
        send('request', item, item.id);
      }),
      this.receiver.subscribe((item) => {
        send('webhook', item, item.id);
      }),
    ];
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, PING_INTERVAL_MS);

    req.on('close', () => {
      clearInterval(ping);
      for (const off of unsubscribe) off();
    });
  }
}
