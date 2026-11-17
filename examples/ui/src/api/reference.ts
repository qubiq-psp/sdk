import { useMemo } from 'react';
import { networkAssets } from '@/lib/networks';
import { useApi } from './hooks';

/**
 * Networks with their assets (`GET /api/networks`) and the tariff (`GET /api/tariff`): the invoice and payout forms
 * take the network and asset choices and the amount limits from them. Read once and kept for the session.
 */
export function useReference() {
  const networks = useApi('listNetworks');
  const tariff = useApi('getMerchantTariff');
  const pairs = useMemo(() => networkAssets(networks.data?.data), [networks.data]);
  return { networks, tariff, pairs, rules: tariff.data?.data.rules ?? null };
}
