import type { RequestOptions, Transport } from '../transport';
import type { GetBalancesParams, MerchantBalances } from '../types';

/** `psp.balances` — the balances of the merchant. */
export class BalancesResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `GET /api/v1/balances`: balances per network and asset and in total per currency, all as of `asOf`.
   * `available` is what can be withdrawn; AML holds, payout holds and freezes are separate fields.
   */
  get(params: GetBalancesParams = {}, options?: RequestOptions): Promise<MerchantBalances> {
    return this.#transport.call('getMerchantBalances', { query: { ...params }, options });
  }
}
