// Deposits — psp.deposits: transfers to the invoice addresses and whether they are credited.
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { PspClient, type ListDepositsParams, type RequestOptions } from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PassthroughQuery, PspRequestOptions, sendSdkResult } from '../example/passthrough';

@Controller('api/deposits')
export class DepositsController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /** Newest first, with `totals` of the whole filter. Find a payment a buyer reports by its `txHash`. */
  @Get()
  @MerchantApiCall('listMerchantDeposits')
  async list(
    @PassthroughQuery() query: ListDepositsParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.deposits.list(query, options));
  }

  @Get(':depositId')
  @MerchantApiCall('getMerchantDeposit')
  async get(
    @Param('depositId') depositId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.deposits.get(depositId, options));
  }
}
