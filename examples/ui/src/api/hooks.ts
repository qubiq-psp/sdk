import { hashKey, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'react';
import { call, type ApiError, type ApiResponse, type CallOptions, type Ok, type OpId } from './client';

/** Query key of a contract call: the operationId first, so a whole area can be refreshed by it. */
export function apiKey<O extends OpId>(operationId: O, options: Pick<CallOptions<O>, 'path' | 'query'> = {}) {
  return [operationId, options.path ?? null, options.query ?? null] as const;
}

// Keys whose next fetch the user asked for (the Refresh button): that fetch is `ui`, not `poll`
const manual = new Set<string>();

/**
 * Which `X-Example-Source` a query fetch sends. The first load of a key and the Refresh button are `ui`; every
 * fetch the UI makes by itself afterwards (auto-refresh, live updates after a webhook, revalidation) is `poll`, so
 * the request log can hide it.
 */
export function sourceOf(qc: QueryClient, key: QueryKey): 'ui' | 'poll' {
  const hash = hashKey(key);
  if (manual.delete(hash)) return 'ui';
  const state = qc.getQueryState(key);
  return state && (state.dataUpdatedAt > 0 || state.errorUpdatedAt > 0) ? 'poll' : 'ui';
}

export interface ApiQueryConfig {
  /** Auto-refresh period, ms; `false` — none. */
  pollMs?: number | false;
  enabled?: boolean;
}

/** A GET of the contract as a query. `data` has the body and the call's meta; `error` is an {@link ApiError}. */
export function useApi<O extends OpId>(
  operationId: O,
  options: Pick<CallOptions<O>, 'path' | 'query'> = {},
  config: ApiQueryConfig = {},
) {
  const qc = useQueryClient();
  const key = apiKey(operationId, options);
  return useQuery<ApiResponse<Ok<O>>, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => call(operationId, { ...options, signal, source: sourceOf(qc, key) }),
    refetchInterval: config.pollMs ?? false,
    refetchIntervalInBackground: false,
    enabled: config.enabled ?? true,
  });
}

/** Refresh by the user: the refetch is sent as `ui`. */
export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(
    (key: QueryKey) => {
      for (const query of qc.getQueryCache().findAll({ queryKey: key })) manual.add(query.queryHash);
      return qc.invalidateQueries({ queryKey: key });
    },
    [qc],
  );
}

/** Refetch everything of these operations (after an action changed them). These refetches are `poll`. */
export function invalidateOps(qc: QueryClient, ...operationIds: OpId[]): void {
  for (const op of operationIds) void qc.invalidateQueries({ queryKey: [op] });
}
