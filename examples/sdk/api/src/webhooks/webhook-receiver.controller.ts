// `POST /webhooks/psp` — the URL to set with `PUT /api/webhook` (`webhookUrl` of `/api/config`). Called by the
// platform without basic auth: the signature is the authentication.
import { setTimeout as sleep } from 'node:timers/promises';
import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhookReceiverService } from './webhook-receiver.service';

export const WEBHOOK_PATH = '/webhooks/psp';

@Controller(WEBHOOK_PATH)
export class WebhookReceiverController {
  constructor(@Inject(WebhookReceiverService) private readonly receiver: WebhookReceiverService) {}

  /**
   * The body arrives as raw bytes (`express.raw()` on this path, see example/http-setup.ts): the signature covers
   * exactly those bytes, and `JSON.stringify(JSON.parse(body))` would give other ones.
   */
  @Post()
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const answer = this.receiver.receive(rawBody, req.headers, req.ip ?? null);
    if (answer.delayMs > 0) await sleep(answer.delayMs);
    res.status(answer.status).json(answer.body);
  }
}
