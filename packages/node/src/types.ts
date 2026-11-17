// Public data types of the merchant API (`/api/v1`). Written by hand for readable docs; src/types.test-d.ts checks
// that they match the OpenAPI schemas of gateway (src/generated/schema.d.ts, `yarn api:sync`).

/** Decimal amount in units of the asset, as a string: `"50"`, `"0.5"`, `"0"`. Never a JSON number. */
export type DecimalString = string;

/** Integer amount in minimal units of the asset, as a string: `"50000000"` for 50 USDT with 6 decimals. */
export type RawAmountString = string;

/** ISO 8601 date-time in UTC with milliseconds: `"2026-09-29T12:00:00.000Z"`. */
export type IsoDateTime = string;

/** Lower-case UUID. */
export type Uuid = string;

/** One page of a list: `items` of page `page` (from 1), `limit` items per page, `total` items in the whole list. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ---------------------------------------------------------------- account

/** The API key that signed the request. */
export interface AccountApiKey {
  /** `X-Api-Key` of this request, `psp_pk_…`. */
  keyId: string;
  /** `previous` — the request is signed with the previous key after a secret rotation: switch to the new one. */
  status: 'current' | 'previous';
  /** Until when the previous key works; `null` for the current key. */
  graceUntil: IsoDateTime | null;
}

/** The merchant behind the API key (`GET /api/v1/account`). */
export interface Account {
  merchantId: Uuid;
  name: string;
  /**
   * An archived merchant (`403 merchant_archived`) and a merchant of a closed user (`403 account_closed`) get no
   * answer at all.
   */
  status: 'active' | 'blocked';
  /** The merchant may create invoices. */
  invoicesEnabled: boolean;
  /** The merchant may request payouts (in the merchant cabinet). */
  payoutsEnabled: boolean;
  apiKey: AccountApiKey;
  /** Server time, Unix seconds: compare with your clock, the signature window is ±300 s. */
  serverTime: number;
}

// ---------------------------------------------------------------- invoices

/**
 * Status of an invoice.
 * - `active` — waiting for the payment;
 * - `partially_paid` — less than `amount` received, the window is still open;
 * - `paid` — the whole amount received: ship the order;
 * - `overpaid` — more than `amount` received: ship the order, the excess is in `overpaid`;
 * - `expired` — the window closed without payments;
 * - `expired_partial` — the window closed with an underpayment (`underpaid`);
 * - `cancelled` — cancelled by the merchant or an admin (`statusReason`).
 */
export type InvoiceStatus =
  'active' | 'partially_paid' | 'paid' | 'overpaid' | 'expired' | 'expired_partial' | 'cancelled';

/** Who cancelled the invoice. */
export type InvoiceStatusReason = 'cancelled_by_merchant' | 'cancelled_by_admin';

/** An invoice: the amount the buyer pays to `address` before `expiresAt`. */
export interface Invoice {
  id: Uuid;
  merchantId: Uuid;
  /** Your order id; unique among your invoices. */
  externalId: string;
  /** Network code, e.g. `tron`, `base`, `polygon`. */
  network: string;
  /** Chain of the network: `mainnet` is real money; testnets are e.g. `nile`, `base-sepolia`, `polygon-amoy`. */
  chain: string;
  /** Asset to pay, e.g. `USDT`. A payment in another asset does not close the invoice. */
  asset: string;
  /** Currency of the asset. */
  currency: string;
  /** Decimals of the asset. */
  decimals: number;
  /** Payment address: show it to the buyer together with `amount`, `asset`, the network and `expiresAt`. */
  address: string;
  /** Memo of memo networks; `null` in TRON and EVM networks. */
  memo: string | null;
  /** Amount to pay. */
  amount: DecimalString;
  /** Amount to pay in minimal units. */
  amountRaw: RawAmountString;
  /** Paid in the window and in the pause after payment, overpayment included. */
  received: DecimalString;
  /** Seen in the network, not confirmed yet: not money yet. */
  pending: DecimalString;
  /** Confirmed but held by the AML check; not in `received`. */
  held: DecimalString;
  /** `max(amount − received, 0)`. */
  remaining: DecimalString;
  /** Received above `amount`. */
  overpaid: DecimalString;
  /** Shortfall, fixed at `expired_partial`; `"0"` before. */
  underpaid: DecimalString;
  /** Paid by late payments after the window closed. */
  lateReceived: DecimalString;
  status: InvoiceStatus;
  statusReason: InvoiceStatusReason | null;
  /** Times an underpayment extended the window. */
  extendedCount: number;
  /** Limit of such extensions for this invoice. */
  maxUnderpaymentResets: number;
  /** The address was issued: the window starts. */
  createdAt: IsoDateTime;
  /** End of the payment window. */
  expiresAt: IsoDateTime;
  /** Block time of the payment that completed the amount. */
  paidAt: IsoDateTime | null;
  /** Transition to a final status. */
  closedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  /** Your description. */
  description: string | null;
  /** Your data, returned as given. */
  metadata: Record<string, unknown> | null;
  /** Every payment with a block time not later than this is already counted. */
  paymentsCheckedUntil: IsoDateTime | null;
  /** Monitoring of the network is late: new payments may show up later than usual. */
  monitoringDelayed: boolean;
}

/** State of a deposit in the network. */
export type DepositStatus = 'detected' | 'confirmed' | 'dropped';

/**
 * How a payment is matched to the invoice: `in_time` — in the window; `after_final` — in the pause after payment;
 * `late` — after the window closed; `wrong_asset` — another asset to the invoice address; other values are payments
 * the platform could not attribute to the invoice amount.
 */
export type PaymentMatchKind =
  | 'in_time'
  | 'after_final'
  | 'late'
  | 'wrong_asset'
  | 'orphan'
  | 'unknown_address'
  | 'dust'
  | 'wrong_network'
  | 'unattributed_native';

/** Result of a payment matched in time: `exact`, `underpaid` or `overpaid`. */
export type PaymentResult = 'exact' | 'underpaid' | 'overpaid';

/** Why a deposit was dropped. */
export type PaymentDropReason = 'fork' | 'tx_failed';

/** Credit of the deposit to the merchant balance. */
export type PaymentCreditStatus =
  'none' | 'paused' | 'aml_wait' | 'aml_hold' | 'credited' | 'unallocated' | 'dust' | 'aml_dirty' | 'income';

/** Result of the AML check; `null` — not checked yet. */
export type AmlStatus = 'pending' | 'clean' | 'review' | 'blocked' | 'unchecked';

/** A payment of the buyer to the invoice address, as the API returns it. */
export interface InvoicePayment {
  depositId: Uuid;
  network: string;
  /** Transaction hash: 64 hex without `0x` in TRON, `0x…` in EVM networks. */
  txHash: string;
  /** Number of the transfer in the transaction. A payment is identified by `(network, txHash, eventIndex)`. */
  eventIndex: number;
  /** Actual asset of the payment: differs from the invoice asset at `wrong_asset`. */
  asset: string;
  decimals: number;
  /** The whole transfer, in units of the asset of the payment. */
  amount: DecimalString;
  amountRaw: RawAmountString;
  fromAddress: string;
  blockNumber: number;
  /** Block time: the payment belongs to the invoice window by it. */
  blockTimestamp: IsoDateTime;
  depositStatus: DepositStatus;
  matchKind: PaymentMatchKind;
  /** For `in_time` and `after_final` after crediting; otherwise `null`. */
  result: PaymentResult | null;
  /** Part that closed the invoice amount; `"0"` at `late` and `wrong_asset`. */
  applied: DecimalString;
  /** Part above the invoice amount. */
  overpaid: DecimalString;
  /** The payment extended the invoice window. */
  extended: boolean;
  /** Set at `dropped`; otherwise `null`. */
  dropReason: PaymentDropReason | null;
  creditStatus: PaymentCreditStatus;
  aml: { status: AmlStatus | null };
}

/** An invoice with all its payments (`GET /api/v1/invoices/{invoiceId}`). */
export interface InvoiceWithPayments extends Invoice {
  payments: InvoicePayment[];
}

/** A change in the history of an invoice (`GET /api/v1/invoices/{invoiceId}/events`). */
export interface InvoiceEvent {
  id: Uuid;
  /** Type of the change, `invoice.*`. */
  type: string;
  statusFrom: InvoiceStatus | null;
  statusTo: InvoiceStatus | null;
  occurredAt: IsoDateTime;
  /** The invoice and the payment of the change. */
  payload: Record<string, unknown>;
}

/** Body of `POST /api/v1/invoices`. */
export interface CreateInvoiceParams {
  /**
   * Your order id, 1–128 characters. Choose it before the first attempt and store it with the order: a retry with
   * the same `externalId` and the same fields returns the invoice created before instead of a duplicate.
   */
  externalId: string;
  /** Network code, e.g. `tron`. */
  network: string;
  /** Asset code, e.g. `USDT`. */
  asset: string;
  /** Amount to pay, a decimal string: `"50"`, `"12.5"`. */
  amount: DecimalString;
  /** Up to 255 characters. */
  description?: string;
  /** Any JSON object; returned in the invoice and in webhooks. */
  metadata?: Record<string, unknown>;
}

/** A time filter: a `Date` or an ISO 8601 string. `from` is inclusive, `to` is exclusive. */
export type DateFilter = Date | IsoDateTime;

/** Page of a list: `page` from 1 (default 1), `limit` 1–100 (default 50). */
export interface PageParams {
  page?: number;
  limit?: number;
}

/** Filters of `GET /api/v1/invoices`; the list is sorted newest first. */
export interface ListInvoicesParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  externalId?: string;
  status?: InvoiceStatus | readonly InvoiceStatus[];
  network?: string;
  asset?: string;
}

/** Body of `POST /api/v1/invoices/{invoiceId}/cancel`. */
export interface CancelInvoiceParams {
  /** Up to 500 characters. */
  reason?: string;
}

// ---------------------------------------------------------------- webhook settings

/** First match of `paused`, `no_url`, `no_secret`, `secret_hold`, `active`. */
export type WebhookDeliveryState = 'active' | 'no_url' | 'no_secret' | 'secret_hold' | 'paused';

/** Deliveries waiting for a URL or a secret, and deliveries in the queue. */
export interface WebhookQueue {
  waiting: number;
  pending: number;
}

/** Whether the platform has applied the last URL change; `pending` after a `202` answer. */
export interface WebhookUrlSync {
  state: 'synced' | 'pending' | 'rejected';
  desiredUrl: string | null;
  rejectedReason: string | null;
  pendingSince: IsoDateTime | null;
}

/**
 * Webhook settings and delivery state (`GET`, `PUT`, `DELETE /api/v1/webhook`). Fields other than `sync` are `null`
 * while the delivery service is unreachable.
 */
export interface WebhookSettings {
  merchantId: Uuid | null;
  /** Callback URL; `null` — not set or removed. */
  webhookUrl: string | null;
  webhookUrlSetAt: IsoDateTime | null;
  /** The secret has reached the delivery service. */
  secretSet: boolean | null;
  secretSetAt: IsoDateTime | null;
  /** Webhooks wait until this time after a secret change; in the past — the hold is over. */
  secretHoldUntil: IsoDateTime | null;
  /** Deliveries are paused by the platform. */
  paused: boolean | null;
  deliveryState: WebhookDeliveryState | null;
  /** Failed notification attempts in a row; any 2xx resets it. */
  consecutiveFailures: number | null;
  /** Since when your endpoint is failing. */
  failingSince: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastSuccessAt: IsoDateTime | null;
  queue: WebhookQueue | null;
  sync: WebhookUrlSync;
}

/** Body of `POST /api/v1/webhook/test`. */
export interface SendTestWebhookParams {
  /** 1–200 characters, default `"Test webhook from PSP"`. */
  message?: string;
}

// ---------------------------------------------------------------- deliveries

/** Type of a webhook body. */
export type WebhookEventType =
  | 'invoice.payment_detected'
  | 'invoice.payment_dropped'
  | 'invoice.payment_held'
  | 'invoice.underpaid'
  | 'invoice.paid'
  | 'invoice.overpaid'
  | 'invoice.expired'
  | 'invoice.expired_partial'
  | 'invoice.late_payment'
  | 'invoice.wrong_asset_payment'
  | 'invoice.cancelled'
  | 'webhook.test';

/** `notification` — a change of an invoice; `test` — `POST /api/v1/webhook/test`. */
export type DeliveryKind = 'notification' | 'test';

/** `waiting` — no URL or secret yet; `pending` — in the retry queue; final: `delivered`, `failed`, `expired`. */
export type DeliveryStatus = 'waiting' | 'pending' | 'delivered' | 'failed' | 'expired';

/** Error of a delivery attempt. */
export type DeliveryErrorCode =
  | 'timeout'
  | 'dns_failed'
  | 'blocked_address'
  | 'connect_failed'
  | 'tls_failed'
  | 'redirect'
  | 'http_error'
  | 'body_too_large'
  | 'lost';

/** A webhook delivery in the delivery log. */
export interface Delivery {
  /** Equals `X-Webhook-Id` and the `id` of the body. */
  id: Uuid;
  /** Order of arrival: deliveries of one invoice go by `seq`. */
  seq: number;
  kind: DeliveryKind;
  merchantId: Uuid;
  invoiceId: Uuid | null;
  type: WebhookEventType;
  /** Version of the body format. */
  version: number;
  network: string;
  chain: string;
  occurredAt: IsoDateTime;
  causationId: Uuid | null;
  /** SHA-256 of the body bytes. */
  bodySha256: string;
  status: DeliveryStatus;
  waitReason: 'no_url' | 'no_secret' | null;
  waitingSince: IsoDateTime | null;
  expiredReason: 'no_url' | 'no_secret' | 'paused' | null;
  /** Attempts in the current cycle. */
  attempts: number;
  /** Attempts of all cycles. */
  totalAttempts: number;
  /** 1 for the first cycle, +1 for every redelivery. */
  cycle: number;
  nextAttemptAt: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastHttpStatus: number | null;
  lastErrorCode: DeliveryErrorCode | null;
  lastError: string | null;
  deliveredAt: IsoDateTime | null;
  failedAt: IsoDateTime | null;
  expiredAt: IsoDateTime | null;
  /** Manual redeliveries. */
  redeliveries: number;
  /** `system:webhook.requests` for a notification, `merchant` for a test webhook. */
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * Headers of a delivery attempt as they were sent to your endpoint (lower-case names). A type literal, so it can be
 * passed to `verifyWebhook({ headers })` as is.
 */
export type DeliveryRequestHeaders = {
  'content-type': string;
  'user-agent': string;
  'x-webhook-id': string;
  'x-webhook-event': string;
  'x-webhook-timestamp': string;
  'x-webhook-signature': string;
  'x-webhook-attempt': string;
};

/** One HTTP attempt of a delivery. */
export interface DeliveryAttempt {
  id: Uuid;
  deliveryId: Uuid;
  cycle: number;
  /** Number in the cycle from 1, equals `X-Webhook-Attempt`. */
  attemptNo: number;
  url: string;
  /** The address the platform connected to; `null` — no connection. */
  resolvedIp: string | null;
  status: 'in_flight' | 'succeeded' | 'failed' | 'lost';
  httpStatus: number | null;
  errorCode: DeliveryErrorCode | null;
  error: string | null;
  /** Headers of your answer, lower-case names; `null` — no answer. */
  responseHeaders: Record<string, string> | null;
  /** The first 4096 bytes of your answer; `null` — no answer. */
  responseBody: string | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  durationMs: number | null;
  createdAt: IsoDateTime;
  requestHeaders: DeliveryRequestHeaders;
  /** Which secret signed the attempt; `null` — unknown. */
  signedWith: 'current' | 'previous' | null;
}

/** A delivery with its body and attempts (`GET /api/v1/webhook/deliveries/{deliveryId}`, the test webhook). */
export interface DeliveryWithAttempts extends Delivery {
  /** The body exactly as sent. */
  body: string;
  deliveryAttempts: DeliveryAttempt[];
}

/** Filters of `GET /api/v1/webhook/deliveries`; the list is sorted newest first. */
export interface ListDeliveriesParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  status?: DeliveryStatus | readonly DeliveryStatus[];
  kind?: DeliveryKind;
  type?: WebhookEventType | readonly WebhookEventType[];
  invoiceId?: Uuid;
}

// ---------------------------------------------------------------- balances

/** Balance of one (network, asset) pair. `total = available + amlHold + payoutHold + frozen`. */
export interface MerchantBalance {
  /** Network code, e.g. `tron`. */
  network: string;
  asset: string;
  /** Currency of the asset. */
  currency: string;
  decimals: number;
  /** Can be withdrawn. */
  available: DecimalString;
  /** Payments under AML review: not part of `available`. */
  amlHold: DecimalString;
  /** Held for payout requests: the amount with our commission and the network fee paid in this asset. */
  payoutHold: DecimalString;
  /** Frozen by the platform manually. */
  frozen: DecimalString;
  /** Sum of the four. */
  total: DecimalString;
}

/** The same fields in total per currency over the networks. */
export interface CurrencyBalance {
  currency: string;
  /** Decimals to show. */
  decimals: number;
  available: DecimalString;
  amlHold: DecimalString;
  payoutHold: DecimalString;
  frozen: DecimalString;
  total: DecimalString;
  /** Networks the sum is made of. */
  networks: string[];
}

/** Balances of the merchant (`GET /api/v1/balances`). A merchant without accounts gets empty lists. */
export interface MerchantBalances {
  merchantId: Uuid;
  /** Per (network, asset). */
  items: MerchantBalance[];
  /** In total per currency. */
  byCurrency: CurrencyBalance[];
  /** Every number is as of this time. */
  asOf: IsoDateTime;
}

/** Filters of `GET /api/v1/balances`. */
export interface GetBalancesParams {
  network?: string;
  asset?: string;
}

// ---------------------------------------------------------------- operations

/**
 * Type of an operation of the ledger, e.g. `deposit_credit`, `payout_hold`, `payout_capture`: only the types that move
 * an account of the merchant. The API answers `400 invalid_schema` to a `type` filter with any other value.
 */
export type OperationType =
  | 'deposit_credit'
  | 'deposit_hold'
  | 'aml_release'
  | 'aml_dirty_assign'
  | 'aml_dirty_release'
  | 'aml_dirty_withdrawal'
  | 'unallocated_assign'
  | 'payout_hold'
  | 'payout_release'
  | 'payout_capture'
  | 'payout_capture_late'
  | 'payout_network_fee_hold'
  | 'payout_network_fee_charge'
  | 'payout_network_fee_release'
  | 'cross_network_payout_hold'
  | 'cross_network_payout_capture'
  | 'cross_network_payout_release'
  | 'cross_network_payout_reversal'
  | 'merchant_credit'
  | 'merchant_debit'
  | 'merchant_freeze'
  | 'merchant_unfreeze'
  | 'fee_refund'
  | 'reversal';

/** Direction: `in` — incoming, `out` — a withdrawal or its network fee, `hold` — a hold or a freeze, `adjust` — an adjustment. */
export type OperationFlow = 'in' | 'out' | 'hold' | 'adjust';

/** Kind of a payment in an operation. */
export type PaymentKind = 'exact' | 'underpaid' | 'overpaid' | 'late' | 'wrong_asset' | 'unallocated' | 'dust';

/** An amount in the native coin of a network (the network fee). */
export interface NativeAmount {
  /** In units of the native coin. */
  amount: DecimalString;
  /** In minimal units: sun of TRX, wei of ETH and POL. */
  amountRaw: RawAmountString;
  /** The native asset `<network>:<symbol>`, e.g. `tron:TRX`. */
  asset: string;
  decimals: number;
}

/** How a commission was computed by a rule of the tariff. */
export interface OperationFeeDetails {
  tariffRuleId: Uuid;
  /** Percent, 0–100. */
  percent: DecimalString;
  /** Fixed part. */
  fixed: DecimalString;
  minFee: DecimalString;
  /** `null` — no ceiling. */
  maxFee: DecimalString | null;
  /** `invoice` — the fixed part once per invoice, cumulatively; `operation` — on each operation. */
  fixedScope: 'invoice' | 'operation';
  rounding: 'ceil';
  /** Cumulative base over the invoice; `null` for payouts. */
  cumulativeBase: DecimalString | null;
  /** Cumulative commission over the invoice; `null` for payouts. */
  cumulativeFee: DecimalString | null;
}

/** The network fee of a payout in an operation of the payout network fee. */
export interface OperationNetworkFee {
  /** `native_balance` — paid in the native coin from the balance; `rate` — in the payout asset at a rate. */
  source: 'native_balance' | 'rate';
  /** Only TRON: the ceiling in TRX by the quote; `null` in an EVM network. */
  maxFeeTrx: DecimalString | null;
  /** Only TRON: TRX burnt by the network, only at `payout_network_fee_charge`. */
  feeTrx: DecimalString | null;
  /** Ceiling in the native coin. */
  max: NativeAmount;
  /** Actually burnt; `null` before the charge. */
  actual: NativeAmount | null;
  /** Units of the payout asset for 1 unit of the native coin at `rate`; `null` at `native_balance`. */
  rate: DecimalString | null;
  rateSource: 'binance' | 'okx' | null;
  rateAt: IsoDateTime | null;
}

/** Recipient of a payout in another network. */
export interface OperationDestination {
  network: string;
  asset: string;
  address: string;
  amount: DecimalString | null;
  fee: DecimalString | null;
}

/** One movement of funds: "received — commission — available" (`GET /api/v1/operations`). */
export interface Operation {
  id: Uuid;
  type: OperationType;
  flow: OperationFlow;
  network: string;
  asset: string;
  decimals: number;
  /** Signed amount before the commission: + in, − out; at `hold` — the amount. */
  gross: DecimalString | null;
  /** Our commission: + withheld, − returned. */
  fee: DecimalString | null;
  /** Change of the funds of the merchant (`available + payoutHold + frozen`); `"0"` at `hold`. */
  net: DecimalString | null;
  paymentKind: PaymentKind | null;
  paymentResult: PaymentResult | null;
  matchKind: PaymentMatchKind | null;
  /** Rest of the invoice before the operation. */
  expected: DecimalString | null;
  /** `gross − expected`: above zero — overpayment, below — underpayment. */
  delta: DecimalString | null;
  /** Available after the operation. */
  availableAfter: DecimalString | null;
  invoiceId: Uuid | null;
  depositId: Uuid | null;
  payoutId: Uuid | null;
  crossNetworkPayoutId: Uuid | null;
  txHash: string | null;
  /** Time of the block or of the decision. */
  effectiveAt: IsoDateTime;
  /** Time of the posting: lists and periods go by it. */
  postedAt: IsoDateTime;
  destination: OperationDestination | null;
  feeDetails: OperationFeeDetails | null;
  networkFee: OperationNetworkFee | null;
}

/** Filters of `GET /api/v1/operations`; the list is sorted by `postedAt`, newest first. */
export interface ListOperationsParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  network?: string;
  asset?: string;
  type?: OperationType | readonly OperationType[];
  invoiceId?: Uuid;
  payoutId?: Uuid;
  crossNetworkPayoutId?: Uuid;
}

/** A period by `postedAt` with optional network and asset: `from` inclusive, `to` exclusive. */
export interface OperationsPeriodParams {
  from: DateFilter;
  to: DateFilter;
  network?: string;
  asset?: string;
}

/** Totals of the operations of one (network, asset) pair for a period. */
export interface OperationsSummaryItem {
  network: string;
  asset: string;
  decimals: number;
  /** Incoming: how much came in. */
  inGross: DecimalString;
  /** Incoming: our commission withheld. */
  inFee: DecimalString;
  /** Incoming: how much became available. */
  inNet: DecimalString;
  /** Paid out, without the network fee. */
  outGross: DecimalString;
  /** Our commission for withdrawals. */
  outFee: DecimalString;
  /** The network fee for transfers. */
  outNetworkFee: DecimalString;
  /** Overpayments of invoices. */
  overpaid: DecimalString;
  /** Shortfalls of invoices closed as `expired_partial`. */
  underpaid: DecimalString;
  /** Available at the end of the period. */
  available: DecimalString;
}

/** Totals of the operations for a period (`GET /api/v1/operations/summary`), no pagination. */
export interface OperationsSummary {
  items: OperationsSummaryItem[];
}

/**
 * One (network, asset) pair of a statement. The funds are `available + payoutHold + frozen`:
 * `closing = opening + inNet − outGross − outFee − outNetworkFee + adjustments`.
 */
export interface StatementItem {
  network: string;
  asset: string;
  decimals: number;
  /** Funds at the start of the period. */
  opening: DecimalString;
  inGross: DecimalString;
  inFee: DecimalString;
  inNet: DecimalString;
  outGross: DecimalString;
  outFee: DecimalString;
  outNetworkFee: DecimalString;
  /** Change of `payoutHold + frozen` over the period, for reference. */
  holdsChange: DecimalString;
  /** Manual adjustments by the platform. */
  adjustments: DecimalString;
  /** Funds at the end of the period. */
  closing: DecimalString;
}

/** Statement for a period in JSON (`GET /api/v1/operations/statement`). */
export interface Statement {
  merchantId: Uuid;
  from: IsoDateTime;
  to: IsoDateTime;
  items: StatementItem[];
}

/** Format of the statement: `json` (default) — a {@link Statement}; `csv` — the same rows as `text/csv`. */
export type StatementFormat = 'json' | 'csv';

/** Parameters of `GET /api/v1/operations/statement`. Day boundaries (UTC) give exact opening and closing. */
export interface StatementParams extends OperationsPeriodParams {
  format?: StatementFormat;
}

// ---------------------------------------------------------------- deposits

/** A transfer in a network to an address of an invoice of the merchant, and what the platform did with it. */
export interface Deposit {
  id: Uuid;
  network: string;
  chain: string;
  /** Address the transfer came to. */
  address: string;
  memo: string | null;
  txHash: string;
  /** Number of the transfer in the transaction. */
  eventIndex: number;
  /** Actual asset of the transfer. */
  asset: string;
  currency: string;
  decimals: number;
  amount: DecimalString;
  amountRaw: RawAmountString;
  fromAddress: string;
  blockNumber: number;
  blockTimestamp: IsoDateTime;
  /** `detected` — seen in the network, `confirmed` — the block is final, `dropped` — will not be confirmed. */
  status: DepositStatus;
  dropReason: PaymentDropReason | null;
  matchKind: PaymentMatchKind | null;
  /** `credited` — credited to the balance; the other values tell why not yet or not at all. */
  creditStatus: PaymentCreditStatus;
  merchantId: Uuid | null;
  invoiceId: Uuid | null;
  /** Credited amount; `"0"` before the credit. */
  gross: DecimalString;
  /** Commission withheld at the credit; `"0"` before it. */
  fee: DecimalString;
  /** Net to the merchant; `"0"` before the credit. */
  net: DecimalString;
  detectedAt: IsoDateTime | null;
  confirmedAt: IsoDateTime | null;
  creditedAt: IsoDateTime | null;
  /** Status of the AML check; the reasons are not shown to the merchant. */
  aml: { status: AmlStatus | null };
}

/** Totals of the whole filter of `GET /api/v1/deposits` (not of one page) per (network, asset). */
export interface DepositTotals {
  network: string;
  asset: string;
  decimals: number;
  /** Deposits of the filter. */
  count: number;
  /** Their sum, `dropped` excluded. */
  amount: DecimalString;
  /** Credited deposits. */
  creditedCount: number;
  /** Commission of the credited deposits. */
  fee: DecimalString;
  /** Net of the credited deposits. */
  net: DecimalString;
}

/** A page of deposits with the totals of the whole filter. */
export interface DepositPage extends Page<Deposit> {
  totals: DepositTotals[];
}

/** Filters of `GET /api/v1/deposits`; the list is sorted by `blockTimestamp`, newest first. */
export interface ListDepositsParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  invoiceId?: Uuid;
  /** Transaction hash: 64 lower-case hex characters in TRON. */
  txHash?: string;
  status?: DepositStatus;
  creditStatus?: PaymentCreditStatus | readonly PaymentCreditStatus[];
  matchKind?: PaymentMatchKind;
  network?: string;
  asset?: string;
}

// ---------------------------------------------------------------- payouts

/**
 * Status of a payout.
 * - `pending_approval` — waits for approval by the platform, the funds are frozen; can be cancelled;
 * - `approved`, `dispatched`, `submitted` — being sent to the network;
 * - `manual_review` — being processed by the platform: show "Processing";
 * - `confirmed` — the transfer is confirmed: `txHash`, `blockNumber`, `networkFeeCharged`;
 * - `failed`, `rejected`, `cancelled`, `expired` (72 h without approval) — final, the freeze is returned.
 */
export type PayoutStatus =
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'manual_review';

/** Stage a payout failed at. */
export type PayoutFailureStage = 'command' | 'preflight' | 'submit' | 'confirm' | 'manual';

/** Why a payout failed. */
export type PayoutFailureReason =
  | 'invalid_schema'
  | 'unknown_type'
  | 'unsupported_version'
  | 'unknown_asset'
  | 'invalid_address'
  | 'own_address'
  | 'destination_blacklisted'
  | 'limit_exceeded'
  | 'insufficient_payout_balance'
  | 'insufficient_payout_trx'
  | 'insufficient_payout_native'
  | 'fee_too_high'
  | 'simulation_failed'
  | 'accept_timeout'
  | 'build_failed'
  | 'reverted'
  | 'expired'
  | 'manual'
  | 'wrong_network'
  | 'network_degraded'
  | 'wallet_stopped'
  | 'cancelled'
  | 'nonce_taken';

/** An amount per asset: what a payout freezes (`debits`) or what is available. */
export interface AssetAmount {
  asset: string;
  amount: DecimalString;
}

/**
 * The network fee of a transfer, paid by the merchant at the actual cost, separately from our commission:
 * in the native coin of the network from the balance, or in the payout asset at a rate.
 */
export interface PayoutNetworkFee {
  /** Asset the fee is paid in: the native coin (`TRX`, `ETH`, `POL`) or the payout asset. */
  asset: string;
  /** Frozen in `asset`; what was actually burnt is charged, the rest is returned. */
  amount: DecimalString;
  /** Only TRON: estimated fee, TRX; `null` in an EVM network. */
  feeTrxEstimated: DecimalString | null;
  /** Only TRON: ceiling, TRX; `null` in an EVM network. */
  maxFeeTrx: DecimalString | null;
  /** Estimate in the native coin. */
  estimated: NativeAmount;
  /** Ceiling in the native coin. */
  max: NativeAmount;
  source: 'native_balance' | 'rate';
  /** Units of the payout asset for 1 unit of the native coin at `rate`; otherwise `null`. */
  rate: DecimalString | null;
  rateSource: 'binance' | 'okx' | null;
  rateAt: IsoDateTime | null;
}

/** A payout: a transfer from the balance of the merchant to an address in a connected network. */
export interface Payout {
  id: Uuid;
  merchantId: Uuid;
  /** Your request id; a retry by the platform after `failed` is a new payout with the same `externalId`. */
  externalId: string;
  network: string;
  asset: string;
  currency: string;
  decimals: number;
  /** Received by the recipient. */
  amount: DecimalString;
  amountRaw: RawAmountString;
  /** Our commission by the tariff, on top. */
  fee: DecimalString;
  /** `amount + fee`: frozen in the payout asset. */
  total: DecimalString;
  networkFee: PayoutNetworkFee;
  /** Charged at the actual cost in `networkFee.asset`; `null` until `confirmed`. */
  networkFeeCharged: DecimalString | null;
  /** Frozen per asset: no more than this is charged. */
  debits: AssetAmount[];
  toAddress: string;
  /** `null` in TRON. */
  memo: string | null;
  status: PayoutStatus;
  txHash: string | null;
  blockNumber: number | null;
  failureStage: PayoutFailureStage | null;
  failureReason: PayoutFailureReason | null;
  /** The original payout of a retry by the platform. */
  retryOfId: Uuid | null;
  /** The quote of the request; `null` — computed again in the request. */
  quoteId: Uuid | null;
  /** Reason of the rejection or the cancellation. */
  reason: string | null;
  createdAt: IsoDateTime;
  approvedAt: IsoDateTime | null;
  dispatchedAt: IsoDateTime | null;
  submittedAt: IsoDateTime | null;
  confirmedAt: IsoDateTime | null;
  failedAt: IsoDateTime | null;
  rejectedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  /** Approval deadline. */
  expiresAt: IsoDateTime | null;
}

/** Payout limits in the payout asset. */
export interface PayoutLimits {
  min: DecimalString;
  max: DecimalString;
  dailyLimit: DecimalString;
  /** Payouts of the merchant this UTC day. */
  dailyUsed: DecimalString;
  dailyRemaining: DecimalString;
}

/** A payout quote: the future request computed without freezing anything. Lives 120 s, fits one request. */
export interface PayoutQuote {
  /** Pass it to `payouts.create()` as `quoteId`. */
  quoteId: Uuid;
  expiresAt: IsoDateTime;
  network: string;
  asset: string;
  decimals: number;
  toAddress: string;
  /** Received by the recipient: the requested amount or `maxAmount`. */
  amount: DecimalString;
  /** Maximum to withdraw with the current balances, tariff, limits and network fee. */
  maxAmount: DecimalString;
  /** Our commission. */
  commission: DecimalString;
  feeDetails: OperationFeeDetails;
  networkFee: PayoutNetworkFee;
  /** Total to be frozen per asset. */
  debits: AssetAmount[];
  /** Available in the payout asset and, when it differs, in the asset of the network fee. */
  available: AssetAmount[];
  limits: PayoutLimits;
}

/** Body of `POST /api/v1/payouts/quote`. */
export interface QuotePayoutParams {
  /** A network with `payoutsEnabled` (`psp.networks.list()`). */
  network: string;
  /** Payout asset in this network. */
  asset: string;
  /** Recipient in the same network. */
  toAddress: string;
  /** Received by the recipient; without it — a quote for the maximum. */
  amount?: DecimalString;
}

/** Body of `POST /api/v1/payouts`. */
export interface CreatePayoutParams {
  /**
   * Your request id, 1–128 characters. Choose it before the first attempt and store it: a retry with the same
   * `externalId` and the same fields returns the payout created before instead of a second payout.
   */
  externalId: string;
  network: string;
  asset: string;
  /** Received by the recipient, a decimal string. */
  amount: DecimalString;
  toAddress: string;
  /** Only for networks with memo, up to 128 characters; not passed in TRON. */
  memo?: string;
  /** A quote of `payouts.quote()`; not part of the `externalId` comparison. */
  quoteId?: Uuid;
}

/** Filters of `GET /api/v1/payouts`; the list is sorted by `createdAt`, newest first. */
export interface ListPayoutsParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  /** Returns the request and the retries of the platform. */
  externalId?: string;
  status?: PayoutStatus | readonly PayoutStatus[];
  network?: string;
  asset?: string;
}

/** Body of `POST /api/v1/payouts/{payoutId}/cancel`. */
export interface CancelPayoutParams {
  /** Up to 500 characters. */
  reason?: string;
}

// ---------------------------------------------------------------- networks and tariff

/** An asset of a connected network. */
export interface NetworkAsset {
  asset: string;
  currency: string;
  standard: 'native' | 'trc20' | 'trc10' | 'erc20';
  /** Token contract; `null` for the native coin. */
  contract: string | null;
  decimals: number;
  invoicesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Dust threshold: a smaller payment is not credited. */
  minCreditAmount: DecimalString;
  /** Platform payout minimum; `null` — none. */
  payoutMin: DecimalString | null;
  /** Platform payout maximum; `null` — none. */
  payoutMax: DecimalString | null;
}

/**
 * A connected network. The list is not fixed — the platform turns on new EVM networks without an API release:
 * take the networks and the assets from `psp.networks.list()`, do not hardcode them.
 */
export interface Network {
  network: string;
  /** `nile` or `mainnet` for `tron`; e.g. `base-sepolia`, `polygon-amoy` or `mainnet` for EVM networks. */
  chain: string;
  family: 'tvm' | 'evm';
  /** One EVM address works in every EVM network. */
  addressSpace: 'tron' | 'evm';
  /** Coin the network takes its fee in: `TRX`, `ETH`, `POL`. */
  nativeCurrency: string;
  /** Link template of a transaction: replace `{txHash}` with the hash. */
  explorerTxUrl: string | null;
  invoicesEnabled: boolean;
  payoutsEnabled: boolean;
  assets: NetworkAsset[];
}

/** Connected networks and their assets (`GET /api/v1/networks`), no pagination. */
export interface Networks {
  items: Network[];
}

/** A fee rule of the tariff. `null` in `network`, `asset`, `currency` — any. */
export interface TariffRule {
  /** `deposit` — a payment of an invoice, `payout`, `cross_network_payout`. */
  operationType: 'deposit' | 'payout' | 'cross_network_payout';
  network: string | null;
  asset: string | null;
  currency: string | null;
  /** Percent, 0–100. */
  percent: DecimalString;
  /** Fixed part in units of the asset. */
  fixed: DecimalString;
  minFee: DecimalString;
  /** `null` — no ceiling. */
  maxFee: DecimalString | null;
  /** Only `deposit`: the smallest invoice amount; `null` — none. */
  invoiceMin: DecimalString | null;
  /** Only `deposit`: the largest invoice amount; `null` — none. */
  invoiceMax: DecimalString | null;
  /** `invoice` — the fixed part, the minimum and the maximum once per invoice; `operation` — on each operation. */
  fixedScope: 'invoice' | 'operation';
  validFrom: IsoDateTime;
  /** `null` — without an end. */
  validTo: IsoDateTime | null;
}

/** The fee rules in force for the merchant (`GET /api/v1/tariff`). */
export interface Tariff {
  tariffPlanName: string;
  rules: TariffRule[];
  /** The moment the rules are chosen for. */
  asOf: IsoDateTime;
}
