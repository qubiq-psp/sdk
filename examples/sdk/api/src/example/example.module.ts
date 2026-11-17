import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ConfigController } from './config.controller';
import { StreamController } from './stream/stream.controller';

/** Example plumbing for the shared UI: the configuration and the SSE stream. */
@Module({
  imports: [WebhooksModule],
  controllers: [ConfigController, StreamController],
})
export class ExampleModule {}
