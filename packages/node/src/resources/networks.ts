import type { RequestOptions, Transport } from '../transport';
import type { Networks } from '../types';

/** `psp.networks` — the connected networks and assets. */
export class NetworksResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `GET /api/v1/networks`: networks and their assets for invoices and payouts, the dust threshold and the platform
   * payout limits. New EVM networks appear here when the platform turns them on: do not hardcode the list.
   */
  list(options?: RequestOptions): Promise<Networks> {
    return this.#transport.call('listNetworks', { options });
  }
}
