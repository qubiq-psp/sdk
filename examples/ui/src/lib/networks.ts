import type { components } from '@psp-examples/contract/types';

type Schemas = components['schemas'];
export type Networks = Schemas['V1Networks'];
export type Network = Schemas['V1Network'];
export type TariffRule = Schemas['V1TariffRule'];

/** One network/asset pair of `GET /api/networks`, with the fields of its network. */
export type NetworkAsset = Schemas['V1NetworkAsset'] &
  Pick<Network, 'network' | 'chain' | 'family' | 'explorerTxUrl'> & { key: string };

export const pairKey = (network: string, asset: string): string => `${network}/${asset}`;

/** Every network/asset pair; `invoicesEnabled`/`payoutsEnabled` — on both the network and the asset. */
export function networkAssets(networks: Networks | null | undefined): NetworkAsset[] {
  return (networks?.items ?? []).flatMap((n) =>
    n.assets.map((a) => ({
      ...a,
      key: pairKey(n.network, a.asset),
      network: n.network,
      chain: n.chain,
      family: n.family,
      explorerTxUrl: n.explorerTxUrl,
      invoicesEnabled: n.invoicesEnabled && a.invoicesEnabled,
      payoutsEnabled: n.payoutsEnabled && a.payoutsEnabled,
    })),
  );
}

/**
 * The tariff rule of an operation type for a pair, from the specific to the general: the asset → the network and
 * currency → the currency → the general rule; of two rules of the same scope — the later `validFrom`. None — `null`
 * (the platform answers `409 tariff_not_configured`).
 */
export function tariffRule(
  rules: readonly TariffRule[],
  operationType: TariffRule['operationType'],
  pair: { network: string; asset: string; currency: string },
): TariffRule | null {
  const scope = (r: TariffRule): number | null => {
    if (r.asset !== null) return r.asset === pair.asset && r.network === pair.network ? 1 : null;
    if (r.network !== null) return r.network === pair.network && r.currency === pair.currency ? 2 : null;
    if (r.currency !== null) return r.currency === pair.currency ? 3 : null;
    return 4;
  };
  let best: { rule: TariffRule; scope: number } | null = null;
  for (const rule of rules) {
    if (rule.operationType !== operationType) continue;
    const s = scope(rule);
    if (s === null) continue;
    if (!best || s < best.scope || (s === best.scope && rule.validFrom > best.rule.validFrom))
      best = { rule, scope: s };
  }
  return best?.rule ?? null;
}

/** An explorer link of a transaction by the network's template. */
export function explorerTx(template: string | null | undefined, txHash: string): string | null {
  return template ? template.replace('{txHash}', txHash) : null;
}

/** A network code for people: upper case (`TRON`, `BASE`). */
export const networkLabel = (network: string): string => network.toUpperCase();
