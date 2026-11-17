import { paginate } from '../pagination';
import type { RequestOptions, Transport } from '../transport';
import type {
  ListOperationsParams,
  Operation,
  OperationsPeriodParams,
  OperationsSummary,
  Page,
  Statement,
  StatementParams,
} from '../types';

/** `psp.operations` — the movements of funds of the merchant, their totals and the statement for accounting. */
export class OperationsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** `GET /api/v1/operations`: one page of operations, newest first by `postedAt`. */
  list(params: ListOperationsParams = {}, options?: RequestOptions): Promise<Page<Operation>> {
    return this.#transport.call('listMerchantOperations', { query: { ...params }, options });
  }

  /** All operations matching the filters, page by page (100 per page by default here). */
  listAll(params: Omit<ListOperationsParams, 'page'> = {}, options?: RequestOptions): AsyncGenerator<Operation, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.list({ ...params, limit, page }, options));
  }

  /** `GET /api/v1/operations/{operationId}`: one operation, in the same form as in the list. */
  get(operationId: string, options?: RequestOptions): Promise<Operation> {
    return this.#transport.call('getMerchantOperation', { path: { operationId }, options });
  }

  /** `GET /api/v1/operations/summary`: totals of the operations for a period per network and asset. */
  getSummary(params: OperationsPeriodParams, options?: RequestOptions): Promise<OperationsSummary> {
    return this.#transport.call('getMerchantOperationsSummary', { query: { ...params }, options });
  }

  /**
   * `GET /api/v1/operations/statement`: the funds at the start and the end of the period and the movement between
   * them, per network and asset. Opening and closing come from end-of-day (UTC) snapshots: set the period at day
   * boundaries. With `format: 'csv'` the same rows come as a `text/csv` string with a header and without BOM
   * (a file for a program; `getResponseMeta()` has nothing for a string — use the `onResponse` hook).
   */
  getStatement(params: StatementParams & { format: 'csv' }, options?: RequestOptions): Promise<string>;
  getStatement(params: StatementParams & { format?: 'json' }, options?: RequestOptions): Promise<Statement>;
  getStatement(params: StatementParams, options?: RequestOptions): Promise<Statement | string>;
  getStatement(params: StatementParams, options?: RequestOptions): Promise<Statement | string> {
    return this.#transport.call('getMerchantOperationsStatement', {
      query: { ...params },
      options,
      responseType: params.format === 'csv' ? 'csv' : 'json',
    });
  }
}
