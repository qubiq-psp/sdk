import type { ReactNode } from 'react';
import type { ApiResponse } from '@/api/client';
import { CallLine } from './call-info';
import { JsonBlock } from './code-block';
import { ErrorView } from './api-error';

/**
 * The result of an action: the error, or the status line and the body. `children` can show the body in a friendlier
 * way; the raw JSON is always one click away.
 */
export function Outcome<T>({
  result,
  error,
  title,
  children,
}: {
  result: ApiResponse<T> | undefined;
  error: unknown;
  title?: string;
  children?: (data: T) => ReactNode;
}) {
  if (error) return <ErrorView error={error} {...(title ? { title } : {})} />;
  if (!result) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" role="status">
      {title && <div className="text-sm font-medium">{title}</div>}
      <CallLine meta={result.meta} />
      {children?.(result.data)}
      {result.data !== undefined && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Response body</summary>
          <JsonBlock value={result.data} maxHeight="max-h-[28rem]" />
        </details>
      )}
    </div>
  );
}
