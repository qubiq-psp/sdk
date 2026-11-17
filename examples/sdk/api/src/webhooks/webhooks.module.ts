import { Module } from '@nestjs/common';
import { ReceivedWebhooksController } from './received-webhooks.controller';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { WebhookReceiverService } from './webhook-receiver.service';

@Module({
  controllers: [WebhookReceiverController, ReceivedWebhooksController],
  providers: [WebhookReceiverService],
  exports: [WebhookReceiverService],
})
export class WebhooksModule {}
