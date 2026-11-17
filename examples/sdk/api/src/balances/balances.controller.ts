// Balances and operations — psp.balances and psp.operations: balances, the ledger, its totals and the statement.
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import {
  PspClient,
  type GetBalancesParams,
  type ListOperationsParams,
  type OperationsPeriodParams,
  type RequestOptions,
  type StatementParams,
} from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PassthroughQuery, PspRequestOptions, sendCsv, sendSdkResult } from '../example/passthrough';

@Controller('api')
export class BalancesController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /** Per network and asset and per currency; `available` is what can be paid out. */
  @Get('balances')
  @MerchantApiCall('getMerchantBalances')
  async balances(
    @PassthroughQuery() query: GetBalancesParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.balances.get(query, options));
  }

  @Get('operations')
  @MerchantApiCall('listMerchantOperations')
  async list(
    @PassthroughQuery() query: ListOperationsParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.operations.list(query, options));
  }

  // Declared before operations/:operationId, so that «summary» and «statement» are not taken for an id
  @Get('operations/summary')
  @MerchantApiCall('getMerchantOperationsSummary')
  async summary(
    @PassthroughQuery() query: OperationsPeriodParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.operations.getSummary(query, options));
  }

  /**
   * JSON, or with `format=csv` the platform's CSV text as a string. `getResponseMeta()` has nothing for a string, so
   * the CSV answer takes its status and headers from the request log's capture of the last attempt.
   */
  @Get('operations/statement')
  @MerchantApiCall('getMerchantOperationsStatement')
  async statement(
    @PassthroughQuery() query: StatementParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    const statement = await this.psp.operations.getStatement(query, options);
    if (typeof statement === 'string') sendCsv(res, statement);
    else sendSdkResult(res, statement);
  }

  @Get('operations/:operationId')
  @MerchantApiCall('getMerchantOperation')
  async get(
    @Param('operationId') operationId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.operations.get(operationId, options));
  }
}
