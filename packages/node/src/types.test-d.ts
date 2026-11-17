// The hand-written public types match the OpenAPI schemas of gateway (src/generated/schema.d.ts, `yarn api:sync`).
// After a sync, a changed field of the spec shows up here as a type error.
import { describe, expectTypeOf, it } from 'vitest';
import type { components, operations } from './generated/schema';
import type {
  Account,
  AssetAmount,
  CancelInvoiceParams,
  CancelPayoutParams,
  CreateInvoiceParams,
  CreatePayoutParams,
  CurrencyBalance,
  Delivery,
  DeliveryAttempt,
  DeliveryWithAttempts,
  Deposit,
  DepositPage,
  DepositTotals,
  GetBalancesParams,
  Invoice,
  InvoiceEvent,
  InvoicePayment,
  InvoiceWithPayments,
  ListDeliveriesParams,
  ListDepositsParams,
  ListInvoicesParams,
  ListOperationsParams,
  ListPayoutsParams,
  MerchantBalance,
  MerchantBalances,
  NativeAmount,
  Network,
  NetworkAsset,
  Networks,
  Operation,
  OperationDestination,
  OperationFeeDetails,
  OperationNetworkFee,
  OperationsPeriodParams,
  OperationsSummary,
  OperationsSummaryItem,
  Page,
  Payout,
  PayoutNetworkFee,
  PayoutQuote,
  QuotePayoutParams,
  SendTestWebhookParams,
  Statement,
  StatementItem,
  StatementParams,
  Tariff,
  TariffRule,
  WebhookEventType,
  WebhookSettings,
} from './types';
import type { InvoiceEventType } from './webhooks/events';

type Schemas = components['schemas'];

/** `true` when A and B are assignable both ways and have the same keys. */
type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;

type Json<T extends keyof operations, S extends number> =
  operations[T]['responses'] extends Record<S, { content: { 'application/json': infer R } }> ? R : never;

type Query<T extends keyof operations> = NonNullable<operations[T]['parameters']['query']>;
type Body<T extends keyof operations> =
  NonNullable<operations[T]['requestBody']> extends { content: { 'application/json': infer B } } ? B : never;

describe('the Same check itself', () => {
  it('sees a missing, an extra and a narrowed field', () => {
    expectTypeOf<Same<Omit<Invoice, 'memo'>, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
    expectTypeOf<Same<Invoice & { extra?: string }, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
    expectTypeOf<Same<Omit<Invoice, 'memo'> & { memo: string }, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
  });
});

describe('responses', () => {
  it('account', () => {
    expectTypeOf<Same<Account, Schemas['AccountResponse']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Account['apiKey'], Schemas['AccountApiKey']>>().toEqualTypeOf<true>();
  });

  it('invoices', () => {
    expectTypeOf<Same<Invoice, Schemas['V1Invoice']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoicePayment, Schemas['V1InvoicePayment']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoiceWithPayments, Schemas['V1InvoiceWithPayments']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoiceEvent, Schemas['V1InvoiceEvent']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Invoice>, Json<'listInvoices', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<InvoiceEvent>, Json<'listInvoiceEvents', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Invoice, Json<'createInvoice', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Invoice, Json<'cancelInvoice', 200>>>().toEqualTypeOf<true>();
  });

  it('webhook settings and deliveries', () => {
    expectTypeOf<Same<WebhookSettings, Schemas['GatewayWebhookSettings']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<WebhookSettings, Json<'setWebhookUrl', 202>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Delivery, Schemas['V1Delivery']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryAttempt, Schemas['V1DeliveryAttempt']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryWithAttempts, Schemas['V1DeliveryFull']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Delivery>, Json<'listDeliveries', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryWithAttempts, Json<'sendTestWebhook', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Delivery, Json<'redeliverDelivery', 200>>>().toEqualTypeOf<true>();
  });

  it('balances, operations and statement', () => {
    expectTypeOf<Same<MerchantBalance, Schemas['V1MerchantBalance']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<CurrencyBalance, Schemas['V1CurrencyBalance']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<MerchantBalances, Json<'getMerchantBalances', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Operation, Schemas['V1Operation']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<OperationDestination, Schemas['V1OperationDestination']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<OperationFeeDetails, Schemas['V1OperationFeeDetails']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<OperationNetworkFee, Schemas['V1OperationNetworkFee']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<NativeAmount, Schemas['V1NativeAmount']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Operation>, Json<'listMerchantOperations', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Operation, Json<'getMerchantOperation', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<OperationsSummaryItem, Schemas['V1OperationsSummaryItem']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<OperationsSummary, Json<'getMerchantOperationsSummary', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<StatementItem, Schemas['V1StatementItem']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Statement, Json<'getMerchantOperationsStatement', 200>>>().toEqualTypeOf<true>();
  });

  it('deposits', () => {
    expectTypeOf<Same<Deposit, Schemas['V1Deposit']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DepositTotals, Schemas['V1DepositTotals']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DepositPage, Json<'listMerchantDeposits', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Deposit, Json<'getMerchantDeposit', 200>>>().toEqualTypeOf<true>();
  });

  it('payouts', () => {
    expectTypeOf<Same<Payout, Schemas['V1Payout']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<PayoutNetworkFee, Schemas['V1PayoutNetworkFee']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<AssetAmount, Schemas['V1AssetAmount']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<PayoutQuote, Schemas['V1PayoutQuote']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<PayoutQuote, Json<'quotePayout', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Payout, Json<'createPayout', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Payout, Json<'createPayout', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Payout>, Json<'listPayouts', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Payout, Json<'getPayout', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Payout, Json<'cancelPayout', 200>>>().toEqualTypeOf<true>();
  });

  it('networks and tariff', () => {
    expectTypeOf<Same<NetworkAsset, Schemas['V1NetworkAsset']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Network, Schemas['V1Network']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Networks, Json<'listNetworks', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<TariffRule, Schemas['V1TariffRule']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Tariff, Json<'getMerchantTariff', 200>>>().toEqualTypeOf<true>();
  });
});

describe('webhook types', () => {
  it('the 11 invoice events and webhook.test are the delivery types of the spec', () => {
    expectTypeOf<InvoiceEventType | 'webhook.test'>().toEqualTypeOf<WebhookEventType>();
    expectTypeOf<WebhookEventType>().toEqualTypeOf<Schemas['V1Delivery']['type']>();
  });
});

describe('request bodies', () => {
  it('match the spec exactly', () => {
    expectTypeOf<Same<CreateInvoiceParams, Body<'createInvoice'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<CancelInvoiceParams, Body<'cancelInvoice'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<SendTestWebhookParams, Body<'sendTestWebhook'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<{ url: string }, Body<'setWebhookUrl'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<QuotePayoutParams, Body<'quotePayout'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<CreatePayoutParams, Body<'createPayout'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<CancelPayoutParams, Body<'cancelPayout'>>>().toEqualTypeOf<true>();
  });
});

describe('query parameters', () => {
  it('have the keys of the spec; values accept what the spec accepts', () => {
    expectTypeOf<Same<keyof ListInvoicesParams, keyof Query<'listInvoices'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof ListDeliveriesParams, keyof Query<'listDeliveries'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<'page' | 'limit', keyof Query<'listInvoiceEvents'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof GetBalancesParams, keyof Query<'getMerchantBalances'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof ListOperationsParams, keyof Query<'listMerchantOperations'>>>().toEqualTypeOf<true>();
    expectTypeOf<
      Same<keyof OperationsPeriodParams, keyof Query<'getMerchantOperationsSummary'>>
    >().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof StatementParams, keyof Query<'getMerchantOperationsStatement'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof ListDepositsParams, keyof Query<'listMerchantDeposits'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof ListPayoutsParams, keyof Query<'listPayouts'>>>().toEqualTypeOf<true>();
    expectTypeOf<Query<'listInvoices'>>().toExtend<ListInvoicesParams>();
    expectTypeOf<Query<'listDeliveries'>>().toExtend<ListDeliveriesParams>();
    expectTypeOf<Query<'getMerchantBalances'>>().toExtend<GetBalancesParams>();
    expectTypeOf<Query<'listMerchantOperations'>>().toExtend<ListOperationsParams>();
    expectTypeOf<Query<'getMerchantOperationsSummary'>>().toExtend<OperationsPeriodParams>();
    expectTypeOf<Query<'getMerchantOperationsStatement'>>().toExtend<StatementParams>();
    expectTypeOf<Query<'listMerchantDeposits'>>().toExtend<ListDepositsParams>();
    expectTypeOf<Query<'listPayouts'>>().toExtend<ListPayoutsParams>();
  });
});
