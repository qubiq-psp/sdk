import { paginate } from '../pagination';
import type { RequestOptions, Transport } from '../transport';
import type { Deposit, DepositPage, ListDepositsParams } from '../types';

/** `psp.deposits` — transfers to the invoice addresses of the merchant and whether they are credited. */
export class DepositsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `GET /api/v1/deposits`: one page of deposits, newest first by `blockTimestamp`, with `totals` of the whole
   * filter. Find the payment a buyer reports by its hash: `psp.deposits.list({ txHash })`.
   */
  list(params: ListDepositsParams = {}, options?: RequestOptions): Promise<DepositPage> {
    return this.#transport.call('listMerchantDeposits', { query: { ...params }, options });
  }

  /** All deposits matching the filters, page by page (100 per page by default here). */
  listAll(params: Omit<ListDepositsParams, 'page'> = {}, options?: RequestOptions): AsyncGenerator<Deposit, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.list({ ...params, limit, page }, options));
  }

  /** `GET /api/v1/deposits/{depositId}`: one deposit. */
  get(depositId: string, options?: RequestOptions): Promise<Deposit> {
    return this.#transport.call('getMerchantDeposit', { path: { depositId }, options });
  }
}
