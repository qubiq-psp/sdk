import { paginate } from '../pagination';
import type { RequestOptions, Transport } from '../transport';
import type {
  CancelPayoutParams,
  CreatePayoutParams,
  ListPayoutsParams,
  Page,
  Payout,
  PayoutQuote,
  QuotePayoutParams,
} from '../types';

/**
 * `psp.payouts` — quotes and payout requests: quote → request (frozen at once) → approval by the platform → transfer.
 * There are no webhooks about payouts: poll `get()` for the status.
 */
export class PayoutsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `POST /api/v1/payouts/quote`: computes a payout without freezing anything — our commission, the network fee,
   * what is frozen per asset, the maximum and the limits. Without `amount` — a quote for the maximum. A quote lives
   * 120 s and fits one request. At most 10 quotes a minute (`429 too_many_requests`, `retryAfterSeconds`).
   * Every call is a new quote, so the SDK repeats it only when the request surely did not run.
   */
  quote(params: QuotePayoutParams, options?: RequestOptions): Promise<PayoutQuote> {
    return this.#transport.call('quotePayout', { body: params, options });
  }

  /**
   * `POST /api/v1/payouts`: a payout request; the amount with our commission and the network fee is frozen at once,
   * the request waits for approval (`pending_approval`). With a valid `quoteId` the calculation of the quote is used.
   *
   * Idempotent by `externalId`: the same `externalId` with the same fields returns the payout created before, in its
   * current state (`getResponseMeta(payout).status` is `200` instead of `201`); with other fields —
   * `409 payout_conflict`. The SDK repeats the call itself after a lost connection, a timeout or a `503`, with the
   * same body. The answer may take up to 130 s: the timeout of this call is at least 180 s, whatever the client
   * default.
   */
  create(params: CreatePayoutParams, options?: RequestOptions): Promise<Payout> {
    return this.#transport.call('createPayout', { body: params, options });
  }

  /** `GET /api/v1/payouts`: one page of payouts, newest first, with the retries of the platform. */
  list(params: ListPayoutsParams = {}, options?: RequestOptions): Promise<Page<Payout>> {
    return this.#transport.call('listPayouts', { query: { ...params }, options });
  }

  /** All payouts matching the filters, page by page (100 per page by default here). */
  listAll(params: Omit<ListPayoutsParams, 'page'> = {}, options?: RequestOptions): AsyncGenerator<Payout, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.list({ ...params, limit, page }, options));
  }

  /** `GET /api/v1/payouts/{payoutId}`: the payout in its current state. */
  get(payoutId: string, options?: RequestOptions): Promise<Payout> {
    return this.#transport.call('getPayout', { path: { payoutId }, options });
  }

  /**
   * `POST /api/v1/payouts/{payoutId}/cancel`: cancels a request in `pending_approval`; the freeze returns to the
   * balance. Idempotent by state: a payout cancelled before is returned as is. Other statuses — `409 invalid_state`.
   */
  cancel(payoutId: string, params?: CancelPayoutParams, options?: RequestOptions): Promise<Payout> {
    return this.#transport.call('cancelPayout', { path: { payoutId }, body: params, options });
  }
}
