// Example plumbing: the log of what reached the receiver, and how the receiver answers.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import {
  WebhookReceiverService,
  type ReceivedWebhook,
  type ReceivedWebhookPage,
  type ReceiverSettings,
} from './webhook-receiver.service';

@Controller('api')
export class ReceivedWebhooksController {
  constructor(@Inject(WebhookReceiverService) private readonly receiver: WebhookReceiverService) {}

  @Get('received-webhooks')
  list(@Query() query: Record<string, unknown>): ReceivedWebhookPage {
    return this.receiver.list(query);
  }

  @Get('received-webhooks/:receivedId')
  get(@Param('receivedId') receivedId: string): ReceivedWebhook {
    return this.receiver.get(receivedId);
  }

  @Delete('received-webhooks')
  @HttpCode(204)
  clear(): void {
    this.receiver.clear();
  }

  @Get('receiver')
  getSettings(): ReceiverSettings {
    return this.receiver.getSettings();
  }

  /** `{ mode, status, delayMs, failNext }`, all required; kept in memory, reset on restart. */
  @Put('receiver')
  setSettings(@Body() body: unknown): ReceiverSettings {
    return this.receiver.setSettings(body);
  }
}
