import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { allRoutes, call } from '@/api/client';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { useStreamState } from '@/api/stream';
import { HttpStatus, ToneBadge } from '@/components/app/badges';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Field } from '@/components/app/field';
import { EnumFilter, FilterBar, TextFilter } from '@/components/app/filters';
import { Outcome } from '@/components/app/outcome';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';
import { useSearchState } from '@/lib/search-state';

const LIMIT = 50;
/** The Merchant API operations, for the filter: the passthrough routes of the contract. */
const OPERATIONS = allRoutes()
  .map((r) => r.merchantApi)
  .filter((op): op is string => op !== null);
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'error'] as const;

export function RequestLogScreen() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const stream = useStreamState();
  const { values, set, page, setPage } = useSearchState(['operationId', 'source', 'callId', 'status'] as const);
  // Auto-refresh calls are hidden unless asked for: `source=ui` by default
  const source: 'ui' | 'poll' | undefined =
    values.source === 'all' ? undefined : values.source === 'poll' ? 'poll' : 'ui';
  const query = {
    page,
    limit: LIMIT,
    ...(values.operationId ? { operationId: values.operationId } : {}),
    ...(source ? { source } : {}),
    ...(values.callId ? { callId: values.callId } : {}),
    ...(values.status ? { status: values.status as (typeof STATUS_CLASSES)[number] } : {}),
  };
  const list = useApi('listRequestLog', { query });
  const clear = useMutation({
    mutationFn: () => call('clearRequestLog'),
    onSettled: () => invalidateOps(qc, 'listRequestLog'),
  });

  return (
    <>
      <PageHeader
        title="Request log"
        description={
          <>
            Every request the backend sent to the Merchant API, newest first: one entry per attempt.{' '}
            {stream === 'open' ? 'New entries appear live.' : 'Live updates are off: use Refresh.'} Entries live in the
            backend's memory and go away on its restart.
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listRequestLog', { query }))}>
              <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <ConfirmButton
              title="Clear the request log?"
              description="DELETE /api/request-log removes every entry in the backend's memory."
              confirmLabel="Clear"
              destructive
              onConfirm={() => clear.mutate()}
            >
              <Trash2 />
              Clear log
            </ConfirmButton>
          </>
        }
      />
      {clear.error !== null && (
        <div className="mb-4">
          <Outcome title="Clear log" result={undefined} error={clear.error} />
        </div>
      )}
      <Section>
        <FilterBar onReset={() => set({ operationId: '', source: '', callId: '', status: '' })}>
          <EnumFilter
            label="Operation"
            value={values.operationId}
            options={OPERATIONS}
            onChange={(v) => set({ operationId: v })}
          />
          <Field label="Source">
            {(p) => (
              <Select value={values.source || 'ui'} onValueChange={(v) => set({ source: v === 'ui' ? '' : v })}>
                <SelectTrigger id={p.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ui">Your actions (auto-refresh hidden)</SelectItem>
                  <SelectItem value="all">Everything</SelectItem>
                  <SelectItem value="poll">Only auto-refresh</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <EnumFilter
            label="Status"
            value={values.status}
            options={STATUS_CLASSES}
            onChange={(v) => set({ status: v })}
          />
          <TextFilter label="Call id" value={values.callId} onChange={(v) => set({ callId: v })} />
        </FilterBar>
        {values.callId && (
          <p className="mb-3 text-sm">
            Showing the attempts of one call (X-Example-Call-Id{' '}
            <span className="font-mono text-xs">{values.callId}</span>
            ).{' '}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => set({ callId: '', source: 'all' })}
            >
              Show all requests
            </button>
          </p>
        )}
        <QueryView query={list} title="Request log">
          {(r) => (
            <>
              {r.items.length === 0 ? (
                <Empty title="No requests">Nothing matches, or the backend restarted.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Answer</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>X-Request-Id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          <Link to={`/log/${e.id}`} className="underline underline-offset-4">
                            {formatTime(e.createdAt)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-mono">{e.operationId}</div>
                          {e.sdkMethod && <div className="text-muted-foreground">psp.{e.sdkMethod}()</div>}
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {e.source === 'poll' && <ToneBadge tone="muted">auto-refresh</ToneBadge>}
                            {e.attempt > 1 && <ToneBadge tone="warning">attempt {e.attempt}</ToneBadge>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs font-mono text-xs break-all">
                          {e.method} {e.path}
                        </TableCell>
                        <TableCell className="text-xs">
                          <HttpStatus status={e.status} label={e.transportError?.code} />
                          {e.errorCode && <div className="mt-0.5 font-mono">{e.errorCode}</div>}
                          {e.apiKeyDeprecatedUntil && <div className="mt-0.5 text-status-warning-fg">previous key</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{e.durationMs} ms</TableCell>
                        <TableCell className="font-mono text-xs break-all">{e.requestId ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pager page={r.page} limit={r.limit} total={r.total} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}
