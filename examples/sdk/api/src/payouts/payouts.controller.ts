// Payouts — psp.payouts: quote, request, list, get, cancel. There are no webhooks about payouts: poll get().
import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import {
  PspClient,
  type CancelPayoutParams,
  type CreatePayoutParams,
  type ListPayoutsParams,
  type QuotePayoutParams,
  type RequestOptions,
} from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PassthroughQuery, PspRequestOptions, sendSdkResult } from '../example/passthrough';

@Controller('api/payouts')
export class PayoutsController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /**
   * Fees, the maximum and the limits, nothing frozen. A quote lives 120 s; at most 10 a minute (`429`). Every call
   * is a new quote, so the SDK repeats it only when it surely did not run.
   */
  @Post('quote')
  @MerchantApiCall('quotePayout')
  async quote(
    @Body() body: QuotePayoutParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.payouts.quote(body, options));
  }

  /**
   * The amount with the fees is frozen at once; the request waits for approval. Idempotent by `externalId` (`201`
   * new, `200` a repeat). The platform may take up to 130 s: the SDK waits at least 180 s for this call and repeats
   * a lost one with the same body (the platform's retry and timeout rules).
   */
  @Post()
  @MerchantApiCall('createPayout')
  async create(
    @Body() body: CreatePayoutParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.payouts.create(body, options));
  }

  @Get()
  @MerchantApiCall('listPayouts')
  async list(
    @PassthroughQuery() query: ListPayoutsParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.payouts.list(query, options));
  }

  @Get(':payoutId')
  @MerchantApiCall('getPayout')
  async get(
    @Param('payoutId') payoutId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.payouts.get(payoutId, options));
  }

  /** Only in `pending_approval`; the freeze returns to the balance. Idempotent by state. */
  @Post(':payoutId/cancel')
  @MerchantApiCall('cancelPayout')
  async cancel(
    @Param('payoutId') payoutId: string,
    @Body() body: CancelPayoutParams | undefined,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.payouts.cancel(payoutId, body, options));
  }
}
