// Invoices — psp.invoices: create, list, get, events, cancel.
import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import {
  PspClient,
  type CancelInvoiceParams,
  type CreateInvoiceParams,
  type ListInvoicesParams,
  type PageParams,
  type RequestOptions,
} from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PassthroughQuery, PspRequestOptions, sendSdkResult } from '../example/passthrough';

// The bodies and the query parameters go to the SDK as received: the platform validates them, and its errors
// (invalid_schema, amount_out_of_range, …) reach the UI unchanged. A shop builds them from its own order instead.
@Controller('api/invoices')
export class InvoicesController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /**
   * Idempotent by `externalId`: the same `externalId` with the same fields returns the invoice created before —
   * `getResponseMeta(invoice).status` is `200` instead of `201`; with other fields `409 invoice_conflict`. The SDK
   * repeats a lost call with the same body, so a retry never makes a second invoice.
   */
  @Post()
  @MerchantApiCall('createInvoice')
  async create(
    @Body() body: CreateInvoiceParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.invoices.create(body, options));
  }

  /** One page, newest first; the next page is `page + 1` while `page * limit < total`. */
  @Get()
  @MerchantApiCall('listInvoices')
  async list(
    @PassthroughQuery() query: ListInvoicesParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.invoices.list(query, options));
  }

  @Get(':invoiceId')
  @MerchantApiCall('getInvoice')
  async get(
    @Param('invoiceId') invoiceId: string,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.invoices.get(invoiceId, options));
  }

  /** The history of the invoice, oldest first. */
  @Get(':invoiceId/events')
  @MerchantApiCall('listInvoiceEvents')
  async listEvents(
    @Param('invoiceId') invoiceId: string,
    @PassthroughQuery() query: PageParams,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.invoices.listEvents(invoiceId, query, options));
  }

  /** Only an invoice without payments: `409 invoice_has_payments` / `invalid_state` otherwise. Idempotent by state. */
  @Post(':invoiceId/cancel')
  @MerchantApiCall('cancelInvoice')
  async cancel(
    @Param('invoiceId') invoiceId: string,
    @Body() body: CancelInvoiceParams | undefined,
    @PspRequestOptions() options: RequestOptions,
    @Res() res: Response,
  ): Promise<void> {
    sendSdkResult(res, await this.psp.invoices.cancel(invoiceId, body, options));
  }
}
