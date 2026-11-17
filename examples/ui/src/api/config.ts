import { useApi } from './hooks';

/** `GET /api/config`: which backend this is and what it is connected to. Read once per page load. */
export function useConfig() {
  return useApi('getConfig');
}
