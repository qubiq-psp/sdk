import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ApiError, ApiResponse } from '@/api/client';
import { ErrorView } from './api-error';
import { Loading } from './page';

/** Loading, the error, or the data of a contract query. */
export function QueryView<T>({
  query,
  title,
  children,
}: {
  query: UseQueryResult<ApiResponse<T>, ApiError>;
  title?: string;
  children: (data: T, response: ApiResponse<T>) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorView error={query.error} {...(title ? { title } : {})} />;
  return <>{children(query.data.data, query.data)}</>;
}
