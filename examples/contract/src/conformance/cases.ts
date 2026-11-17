// One forwarding case per Merchant API operation: the contract request, and what the platform must receive.

export const IDS = {
  invoice: '97da92f5-45c0-411b-9ed5-6793b396cd5f',
  operation: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
  deposit: 'e0b38e4d-4bba-4291-9eb5-6c26144f19c3',
  payout: '3b9c1e2a-7d4f-4a8b-9c6d-5e2f1a0b9c8d',
  delivery: '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f',
} as const;

const PERIOD = 'from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z';
const TO_ADDRESS = 'TRPVdtxhhSuP22mNW77LwGicsZDTrqpCrT';

export interface ForwardCase {
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Contract path with the query, e.g. `/api/invoices?status=active,partially_paid&limit=20`. */
  path: string;
  /** JSON body sent to the backend; undefined — none. */
  body?: unknown;
  /** The platform path (without the query) the backend must call. */
  merchantPath: string;
}

export const FORWARD_CASES: ForwardCase[] = [
  { operationId: 'getAccount', method: 'GET', path: '/api/account', merchantPath: '/api/v1/account' },
  {
    operationId: 'createInvoice',
    method: 'POST',
    path: '/api/invoices',
    body: {
      externalId: 'conformance-order-1',
      network: 'tron',
      asset: 'USDT',
      amount: '50',
      description: 'Заказ 10530',
      metadata: { orderId: '10530' },
    },
    merchantPath: '/api/v1/invoices',
  },
  {
    operationId: 'listInvoices',
    method: 'GET',
    path: '/api/invoices?status=active,partially_paid&limit=20&page=2&externalId=order-10530',
    merchantPath: '/api/v1/invoices',
  },
  {
    operationId: 'getInvoice',
    method: 'GET',
    path: `/api/invoices/${IDS.invoice}`,
    merchantPath: `/api/v1/invoices/${IDS.invoice}`,
  },
  {
    operationId: 'listInvoiceEvents',
    method: 'GET',
    path: `/api/invoices/${IDS.invoice}/events?page=1&limit=10`,
    merchantPath: `/api/v1/invoices/${IDS.invoice}/events`,
  },
  {
    operationId: 'cancelInvoice',
    method: 'POST',
    path: `/api/invoices/${IDS.invoice}/cancel`,
    body: { reason: 'Покупатель передумал' },
    merchantPath: `/api/v1/invoices/${IDS.invoice}/cancel`,
  },
  {
    operationId: 'getMerchantBalances',
    method: 'GET',
    path: '/api/balances?network=tron&asset=USDT',
    merchantPath: '/api/v1/balances',
  },
  {
    operationId: 'listMerchantOperations',
    method: 'GET',
    path: `/api/operations?${PERIOD}&type=deposit_credit,payout_hold&network=tron&limit=5`,
    merchantPath: '/api/v1/operations',
  },
  {
    operationId: 'getMerchantOperationsSummary',
    method: 'GET',
    path: `/api/operations/summary?${PERIOD}&asset=USDT`,
    merchantPath: '/api/v1/operations/summary',
  },
  {
    operationId: 'getMerchantOperationsStatement',
    method: 'GET',
    path: `/api/operations/statement?${PERIOD}`,
    merchantPath: '/api/v1/operations/statement',
  },
  {
    operationId: 'getMerchantOperation',
    method: 'GET',
    path: `/api/operations/${IDS.operation}`,
    merchantPath: `/api/v1/operations/${IDS.operation}`,
  },
  {
    operationId: 'listMerchantDeposits',
    method: 'GET',
    path: `/api/deposits?invoiceId=${IDS.invoice}&creditStatus=credited,aml_hold&limit=3`,
    merchantPath: '/api/v1/deposits',
  },
  {
    operationId: 'getMerchantDeposit',
    method: 'GET',
    path: `/api/deposits/${IDS.deposit}`,
    merchantPath: `/api/v1/deposits/${IDS.deposit}`,
  },
  {
    operationId: 'quotePayout',
    method: 'POST',
    path: '/api/payouts/quote',
    body: { network: 'tron', asset: 'USDT', toAddress: TO_ADDRESS, amount: '1500' },
    merchantPath: '/api/v1/payouts/quote',
  },
  {
    operationId: 'createPayout',
    method: 'POST',
    path: '/api/payouts',
    body: { externalId: 'conformance-payout-1', network: 'tron', asset: 'USDT', toAddress: TO_ADDRESS, amount: '1500' },
    merchantPath: '/api/v1/payouts',
  },
  {
    operationId: 'listPayouts',
    method: 'GET',
    path: '/api/payouts?status=pending_approval&limit=10',
    merchantPath: '/api/v1/payouts',
  },
  {
    operationId: 'getPayout',
    method: 'GET',
    path: `/api/payouts/${IDS.payout}`,
    merchantPath: `/api/v1/payouts/${IDS.payout}`,
  },
  {
    operationId: 'cancelPayout',
    method: 'POST',
    path: `/api/payouts/${IDS.payout}/cancel`,
    body: { reason: 'Wrong address' },
    merchantPath: `/api/v1/payouts/${IDS.payout}/cancel`,
  },
  { operationId: 'listNetworks', method: 'GET', path: '/api/networks', merchantPath: '/api/v1/networks' },
  { operationId: 'getMerchantTariff', method: 'GET', path: '/api/tariff', merchantPath: '/api/v1/tariff' },
  { operationId: 'getWebhookSettings', method: 'GET', path: '/api/webhook', merchantPath: '/api/v1/webhook' },
  {
    operationId: 'setWebhookUrl',
    method: 'PUT',
    path: '/api/webhook',
    body: { url: 'https://shop.example.com/psp/webhooks' },
    merchantPath: '/api/v1/webhook',
  },
  { operationId: 'removeWebhookUrl', method: 'DELETE', path: '/api/webhook', merchantPath: '/api/v1/webhook' },
  {
    operationId: 'sendTestWebhook',
    method: 'POST',
    path: '/api/webhook/test',
    body: { message: 'Проверка после смены URL' },
    merchantPath: '/api/v1/webhook/test',
  },
  {
    operationId: 'listDeliveries',
    method: 'GET',
    path: `/api/webhook/deliveries?kind=test&status=failed,expired&limit=5`,
    merchantPath: '/api/v1/webhook/deliveries',
  },
  {
    operationId: 'getDelivery',
    method: 'GET',
    path: `/api/webhook/deliveries/${IDS.delivery}`,
    merchantPath: `/api/v1/webhook/deliveries/${IDS.delivery}`,
  },
  {
    operationId: 'redeliverDelivery',
    method: 'POST',
    path: `/api/webhook/deliveries/${IDS.delivery}/redeliver`,
    merchantPath: `/api/v1/webhook/deliveries/${IDS.delivery}/redeliver`,
  },
];
