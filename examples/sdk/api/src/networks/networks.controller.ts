// Networks and tariff — psp.networks.list() and psp.tariff.get(): what the invoice and payout forms offer.
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { PspClient, type RequestOptions } from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PspRequestOptions, sendSdkResult } from '../example/passthrough';

@Controller('api')
export class NetworksController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /** Networks and assets for invoices and payouts, payout limits. New networks appear here: do not hardcode them. */
  @Get('networks')
  @MerchantApiCall('listNetworks')
  async networks(@PspRequestOptions() options: RequestOptions, @Res() res: Response): Promise<void> {
    sendSdkResult(res, await this.psp.networks.list(options));
  }

  /** The fee rules in force, with the invoice amount limits. */
  @Get('tariff')
  @MerchantApiCall('getMerchantTariff')
  async tariff(@PspRequestOptions() options: RequestOptions, @Res() res: Response): Promise<void> {
    sendSdkResult(res, await this.psp.tariff.get(options));
  }
}
