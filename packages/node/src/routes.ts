// All 27 operations of the merchant API (gateway docs/13-merchant-api.md, 13.9).
// src/routes.test.ts checks this table against api/openapi.v1.json, the copy of the gateway spec.

/**
 * Retry rule of an operation (gateway docs/13-merchant-api.md, 13.10):
 * - `safe` — repeat after a connection error, a timeout or a retryable answer (reads, idempotent writes);
 * - `once` — at most one repeat, only when the connection broke before an answer;
 * - `never` — every call is a new action on the platform.
 */
export type RetryRule = 'safe' | 'once' | 'never';

/** One operation: HTTP method, path template with `{param}` placeholders, retry rule. */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  retry: RetryRule;
  /**
   * Shortest timeout of one attempt, ms: a lower `timeoutMs` of the client is raised to it for this operation
   * (an explicit `timeoutMs` of the call is kept as given).
   */
  minTimeoutMs?: number;
}

/**
 * Client timeout of a payout request (gateway 13.10): gateway may take up to 130 s to answer it, a shorter timeout
 * turns a payout that is still being created into an unknown outcome.
 */
export const PAYOUT_TIMEOUT_MS = 180_000;

export const ROUTES = {
  getAccount: { method: 'GET', path: '/api/v1/account', retry: 'safe' },
  createInvoice: { method: 'POST', path: '/api/v1/invoices', retry: 'safe' },
  listInvoices: { method: 'GET', path: '/api/v1/invoices', retry: 'safe' },
  getInvoice: { method: 'GET', path: '/api/v1/invoices/{invoiceId}', retry: 'safe' },
  listInvoiceEvents: { method: 'GET', path: '/api/v1/invoices/{invoiceId}/events', retry: 'safe' },
  cancelInvoice: { method: 'POST', path: '/api/v1/invoices/{invoiceId}/cancel', retry: 'safe' },
  getWebhookSettings: { method: 'GET', path: '/api/v1/webhook', retry: 'safe' },
  setWebhookUrl: { method: 'PUT', path: '/api/v1/webhook', retry: 'safe' },
  removeWebhookUrl: { method: 'DELETE', path: '/api/v1/webhook', retry: 'safe' },
  sendTestWebhook: { method: 'POST', path: '/api/v1/webhook/test', retry: 'never' },
  listDeliveries: { method: 'GET', path: '/api/v1/webhook/deliveries', retry: 'safe' },
  getDelivery: { method: 'GET', path: '/api/v1/webhook/deliveries/{deliveryId}', retry: 'safe' },
  redeliverDelivery: { method: 'POST', path: '/api/v1/webhook/deliveries/{deliveryId}/redeliver', retry: 'once' },
  getMerchantBalances: { method: 'GET', path: '/api/v1/balances', retry: 'safe' },
  listMerchantOperations: { method: 'GET', path: '/api/v1/operations', retry: 'safe' },
  getMerchantOperationsSummary: { method: 'GET', path: '/api/v1/operations/summary', retry: 'safe' },
  getMerchantOperationsStatement: { method: 'GET', path: '/api/v1/operations/statement', retry: 'safe' },
  getMerchantOperation: { method: 'GET', path: '/api/v1/operations/{operationId}', retry: 'safe' },
  listMerchantDeposits: { method: 'GET', path: '/api/v1/deposits', retry: 'safe' },
  getMerchantDeposit: { method: 'GET', path: '/api/v1/deposits/{depositId}', retry: 'safe' },
  // Every call is a new quote and one of the 10 quotes a minute: repeated only when it surely did not run
  quotePayout: { method: 'POST', path: '/api/v1/payouts/quote', retry: 'never' },
  // Idempotent by externalId, like createInvoice
  createPayout: { method: 'POST', path: '/api/v1/payouts', retry: 'safe', minTimeoutMs: PAYOUT_TIMEOUT_MS },
  listPayouts: { method: 'GET', path: '/api/v1/payouts', retry: 'safe' },
  getPayout: { method: 'GET', path: '/api/v1/payouts/{payoutId}', retry: 'safe' },
  cancelPayout: { method: 'POST', path: '/api/v1/payouts/{payoutId}/cancel', retry: 'safe' },
  listNetworks: { method: 'GET', path: '/api/v1/networks', retry: 'safe' },
  getMerchantTariff: { method: 'GET', path: '/api/v1/tariff', retry: 'safe' },
} as const satisfies Record<string, Route>;

/** operationId of one of the covered operations. */
export type OperationId = keyof typeof ROUTES;
