// The public API as a merchant sees it through the package entry: signatures, narrowing of errors and events.
import { describe, expectTypeOf, it } from 'vitest';
import {
  PspClient,
  isPspApiError,
  verifyWebhook,
  type DeliveryWithAttempts,
  type Deposit,
  type DepositPage,
  type Invoice,
  type InvoiceWithPayments,
  type MerchantBalances,
  type Networks,
  type Operation,
  type OperationsSummary,
  type Page,
  type Payout,
  type PayoutQuote,
  type Statement,
  type StatementFormat,
  type Tariff,
  type WebhookEvent,
  type WebhookSettings,
} from '../../src/index';

declare const psp: PspClient;

describe('public API', () => {
  it('methods return the documented types', () => {
    expectTypeOf(psp.invoices.create).returns.toEqualTypeOf<Promise<Invoice>>();
    expectTypeOf(psp.invoices.get).returns.toEqualTypeOf<Promise<InvoiceWithPayments>>();
    expectTypeOf(psp.invoices.list).returns.toEqualTypeOf<Promise<Page<Invoice>>>();
    expectTypeOf(psp.invoices.listAll).returns.toEqualTypeOf<AsyncGenerator<Invoice, void>>();
    expectTypeOf(psp.webhook.setUrl).returns.toEqualTypeOf<Promise<WebhookSettings>>();
    expectTypeOf(psp.webhook.sendTest).returns.toEqualTypeOf<Promise<DeliveryWithAttempts>>();
    expectTypeOf(psp.webhook.verify).returns.toEqualTypeOf<WebhookEvent>();
    expectTypeOf(verifyWebhook).returns.toEqualTypeOf<WebhookEvent>();
  });

  it('balances, operations, deposits, payouts, networks and tariff return the documented types', () => {
    expectTypeOf(psp.balances.get).returns.toEqualTypeOf<Promise<MerchantBalances>>();
    expectTypeOf(psp.operations.list).returns.toEqualTypeOf<Promise<Page<Operation>>>();
    expectTypeOf(psp.operations.listAll).returns.toEqualTypeOf<AsyncGenerator<Operation, void>>();
    expectTypeOf(psp.operations.get).returns.toEqualTypeOf<Promise<Operation>>();
    expectTypeOf(psp.operations.getSummary).returns.toEqualTypeOf<Promise<OperationsSummary>>();
    expectTypeOf(psp.deposits.list).returns.toEqualTypeOf<Promise<DepositPage>>();
    expectTypeOf(psp.deposits.listAll).returns.toEqualTypeOf<AsyncGenerator<Deposit, void>>();
    expectTypeOf(psp.deposits.get).returns.toEqualTypeOf<Promise<Deposit>>();
    expectTypeOf(psp.payouts.quote).returns.toEqualTypeOf<Promise<PayoutQuote>>();
    expectTypeOf(psp.payouts.create).returns.toEqualTypeOf<Promise<Payout>>();
    expectTypeOf(psp.payouts.list).returns.toEqualTypeOf<Promise<Page<Payout>>>();
    expectTypeOf(psp.payouts.listAll).returns.toEqualTypeOf<AsyncGenerator<Payout, void>>();
    expectTypeOf(psp.payouts.get).returns.toEqualTypeOf<Promise<Payout>>();
    expectTypeOf(psp.payouts.cancel).returns.toEqualTypeOf<Promise<Payout>>();
    expectTypeOf(psp.networks.list).returns.toEqualTypeOf<Promise<Networks>>();
    expectTypeOf(psp.tariff.get).returns.toEqualTypeOf<Promise<Tariff>>();
  });

  it('the statement is a Statement in JSON and a string in CSV', () => {
    const period = { from: new Date(), to: '2026-09-30T00:00:00.000Z' };
    expectTypeOf(psp.operations.getStatement(period)).toEqualTypeOf<Promise<Statement>>();
    expectTypeOf(psp.operations.getStatement({ ...period, format: 'json' })).toEqualTypeOf<Promise<Statement>>();
    expectTypeOf(psp.operations.getStatement({ ...period, format: 'csv' })).toEqualTypeOf<Promise<string>>();
    const format = 'csv' as StatementFormat;
    expectTypeOf(psp.operations.getStatement({ ...period, format })).toEqualTypeOf<Promise<Statement | string>>();
    // @ts-expect-error the period is required
    void psp.operations.getStatement({ format: 'csv' });
    // @ts-expect-error unknown format
    void psp.operations.getStatement({ ...period, format: 'xlsx' });
  });

  it('a payout takes decimal strings only and needs externalId', () => {
    // @ts-expect-error a JSON number is not an amount
    void psp.payouts.create({ externalId: 'w', network: 'tron', asset: 'USDT', amount: 10, toAddress: 'T' });
    // @ts-expect-error externalId makes a retry safe: it is required
    void psp.payouts.create({ network: 'tron', asset: 'USDT', amount: '10', toAddress: 'T' });
    // @ts-expect-error unknown status
    void psp.payouts.list({ status: 'paid' });
  });

  it('create takes decimal strings only, list takes typed statuses', () => {
    expectTypeOf(psp.invoices.create).parameter(0).toEqualTypeOf<{
      externalId: string;
      network: string;
      asset: string;
      amount: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>();
    // @ts-expect-error a JSON number is not an amount
    void psp.invoices.create({ externalId: 'o', network: 'tron', asset: 'USDT', amount: 50 });
    // @ts-expect-error unknown status
    void psp.invoices.list({ status: 'unpaid' });
  });

  it('isPspApiError narrows details by the code', () => {
    const err: unknown = null;
    if (isPspApiError(err, 'amount_out_of_range')) {
      expectTypeOf(err.details.min).toEqualTypeOf<string>();
      expectTypeOf(err.details.max).toEqualTypeOf<string | null>();
    }
    if (isPspApiError(err) && err.is('invoice_conflict')) {
      expectTypeOf(err.details.invoiceId).toEqualTypeOf<string>();
    }
    if (isPspApiError(err, 'payout_conflict')) {
      expectTypeOf(err.details.payoutId).toEqualTypeOf<string>();
    }
    if (isPspApiError(err, 'limit_exceeded')) {
      expectTypeOf(err.details.actual).toEqualTypeOf<string | null>();
    }
  });
});
