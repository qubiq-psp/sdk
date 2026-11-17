import { Module } from '@nestjs/common';
import { WebhookSettingsController } from './webhook-settings.controller';

@Module({ controllers: [WebhookSettingsController] })
export class WebhookSettingsModule {}
