import { Link } from 'react-router';
import { ScrollText } from 'lucide-react';
import type { CallMeta } from '@/api/client';
import { formatTime } from '@/lib/format';
import { HttpStatus, ToneBadge } from './badges';
import { CopyValue } from './code-block';

/** Link to the request-log entries of one call (`X-Example-Call-Id`). */
export function LogLink({
  callId,
  label = 'In the request log',
}: {
  callId: string | null | undefined;
  label?: string;
}) {
  if (!callId) return null;
  return (
    <Link
      to={`/log?callId=${encodeURIComponent(callId)}`}
      className="inline-flex items-center gap-1 text-xs underline underline-offset-4 hover:text-foreground"
      title={`Request-log entries of call ${callId}`}
    >
      <ScrollText className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}

/** One line about a call: status, method and URL, time, the platform's ids, and the link to the request log. */
export function CallLine({ meta }: { meta: CallMeta }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <HttpStatus status={meta.status} />
      <span className="font-mono break-all text-foreground">
        {meta.method} {meta.url}
      </span>
      <span>
        {formatTime(meta.startedAt)} · {meta.durationMs} ms
      </span>
      {meta.source === 'poll' && <ToneBadge tone="muted">auto-refresh</ToneBadge>}
      {meta.requestId && (
        <span className="inline-flex items-center gap-1">
          X-Request-Id <CopyValue value={meta.requestId} />
        </span>
      )}
      {meta.clientRequestId && <span>X-Client-Request-Id {meta.clientRequestId}</span>}
      {meta.apiKeyDeprecated && (
        <ToneBadge tone="warning">previous API key, works until {formatTime(meta.apiKeyDeprecated)}</ToneBadge>
      )}
      <LogLink callId={meta.callId} />
    </div>
  );
}
