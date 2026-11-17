import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/api/client';
import { CallLine } from './call-info';
import { CodeBlock, JsonBlock } from './code-block';

const ORIGIN_LABEL = {
  platform: 'Error from the platform',
  backend: 'Error from the example backend',
  network: 'No answer from the example backend',
} as const;

/**
 * Any failed call: `errorCode`, the message, `details` as they came, how the call went and the link to its
 * request-log entries. At `401 api_auth_failed` the platform's string to sign is shown on its own.
 */
export function ErrorView({ error, title }: { error: unknown; title?: string }) {
  if (!(error instanceof ApiError)) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{title ?? 'Error'}</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
      </Alert>
    );
  }
  const stringToSign =
    typeof error.details === 'object' && error.details !== null
      ? (error.details as Record<string, unknown>)['stringToSign']
      : undefined;
  return (
    <Alert variant="destructive" data-error-code={error.errorCode}>
      <AlertTriangle />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {title && <span>{title}:</span>}
        <span className="font-mono">{error.errorCode}</span>
        <span className="text-xs font-normal opacity-80">{ORIGIN_LABEL[error.origin]}</span>
      </AlertTitle>
      <AlertDescription>
        <div className="flex w-full min-w-0 flex-col gap-2">
          <p className="break-words">{error.errorMessage}</p>
          {error.meta.retryAfter && <p>Retry after: {error.meta.retryAfter} s</p>}
          {typeof stringToSign === 'string' && (
            <CodeBlock
              label="The string the platform signed (details.stringToSign): compare it with the request log"
              value={stringToSign}
              maxHeight="max-h-40"
            />
          )}
          {error.details !== null && error.details !== undefined && (
            <JsonBlock label="details" value={error.details} maxHeight="max-h-60" />
          )}
          {error.bodyText && <CodeBlock label="Body" value={error.bodyText} maxHeight="max-h-40" />}
          <CallLine meta={error.meta} />
        </div>
      </AlertDescription>
    </Alert>
  );
}
