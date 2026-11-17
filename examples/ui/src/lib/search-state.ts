import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List filters in the address bar (`?status=paid&page=2`): a screen can be linked to, reloaded and shared with
 * its filters. Changing a filter other than `page` goes back to page 1.
 */
export function useSearchState<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>;
  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries<string | undefined>(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const page = Math.max(1, Number(params.get('page')) || 1);
  return {
    values,
    set,
    page,
    setPage: (p: number) => set({ page: p > 1 ? String(p) : '' } as Partial<Record<K, string>>),
  };
}

/** A comma-separated list value of the address bar as an array. */
export const listOf = (value: string): string[] => (value ? value.split(',').filter(Boolean) : []);
