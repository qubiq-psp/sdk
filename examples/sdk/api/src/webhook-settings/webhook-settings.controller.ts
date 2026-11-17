// Webhook settings — psp.webhook and psp.webhook.deliveries: the URL, the test webhook, the delivery log, redelivery.
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { PspClient, type ListDeliveriesParams, type RequestOptions, type SendTestWebhookParams } from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PassthroughQuery, PspRequestOptions, sendSdkResult } from '../example/passthrough';

@Controller('api/webhook')
export class WebhookSettingsController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  @Get()
  @MerchantApiCall('getWebhookSettings')
  async get(@PspRequestOptions() options: RequestOptions, @Res() res: Response): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.get(options));
  }

  /**
   * `psp.webhook.setUrl(url)`: only `url` of the body reaches the platform. `202` with `sync.state: 'pending'` — the
   * platform finishes the change itself: read it later with get(), do not repeat the call.
   */
  @Put()
  @MerchantApiCall('setWebhookUrl')
  async setUrl(
    @Body() body: { url: string } | undefined,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.setUrl(body?.url as string, options));
  }

  @Delete()
  @MerchantApiCall('removeWebhookUrl')
  async removeUrl(@PspRequestOptions() options: RequestOptions, @Res() res: Response): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.removeUrl(options));
  }

  /** Sends a `webhook.test` and returns the delivery with its attempt. At most once per 10 s; never repeated by the SDK. */
  @Post('test')
  @MerchantApiCall('sendTestWebhook')
  async sendTest(
    @Body() body: SendTestWebhookParams | undefined,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.sendTest(body, options));
  }

  @Get('deliveries')
  @MerchantApiCall('listDeliveries')
  async listDeliveries(
    @PassthroughQuery() query: ListDeliveriesParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.deliveries.list(query, options));
  }

  @Get('deliveries/:deliveryId')
  @MerchantApiCall('getDelivery')
  async getDelivery(
    @Param('deliveryId') deliveryId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.deliveries.get(deliveryId, options));
  }

  /** A new cycle of attempts for a delivered, failed or expired delivery. Repeated by the SDK at most once. */
  @Post('deliveries/:deliveryId/redeliver')
  @MerchantApiCall('redeliverDelivery')
  async redeliver(
    @Param('deliveryId') deliveryId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.webhook.deliveries.redeliver(deliveryId, options));
  }
}
