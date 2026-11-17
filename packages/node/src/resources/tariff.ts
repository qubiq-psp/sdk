import type { RequestOptions, Transport } from '../transport';
import type { Tariff } from '../types';

/** `psp.tariff` — the fee rules of the merchant. */
export class TariffResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `GET /api/v1/tariff`: the fee rules in force for the merchant — for invoices (`deposit`, with the invoice amount
   * limits) and for payouts.
   */
  get(options?: RequestOptions): Promise<Tariff> {
    return this.#transport.call('getMerchantTariff', { options });
  }
}
