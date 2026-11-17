import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { call } from '@/api/client';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { DELIVERY_TONES, httpTone, StatusBadge, ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { CodeBlock, CopyValue, JsonBlock } from '@/components/app/code-block';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Outcome } from '@/components/app/outcome';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { ReceivedTable } from '@/screens/received/table';
import { formatTime, headersText, prettyJson } from '@/lib/format';

export function DeliveryScreen() {
  const { deliveryId = '' } = useParams();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const delivery = useApi('getDelivery', { path: { deliveryId } });
  const webhookId = deliveryId;
  // The receiver's copies of this delivery: the contract pins the delivery id = X-Webhook-Id
  const copies = useApi('listReceivedWebhooks', { query: { webhookId, limit: 50 } });
  const redeliver = useMutation({
    mutationFn: () => call('redeliverDelivery', { path: { deliveryId } }),
    onSettled: () => invalidateOps(qc, 'getDelivery', 'listDeliveries'),
  });

  return (
    <>
      <PageHeader
        title="Delivery"
        description={
          <span className="flex flex-wrap items-center gap-1">
            GET /api/webhook/deliveries/{'{deliveryId}'} · <CopyValue value={deliveryId} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/webhooks">Webhook settings</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh(apiKey('getDelivery', { path: { deliveryId } }))}
            >
              <RefreshCw className={delivery.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <ConfirmButton
              title="Send this webhook again?"
              description="POST /api/webhook/deliveries/{deliveryId}/redeliver: the platform sends the same body with the same X-Webhook-Id; a receiver that already accepted it reports a duplicate."
              confirmLabel="Send again"
              disabled={redeliver.isPending}
              onConfirm={() => redeliver.mutate()}
            >
              <RotateCw />
              Send again
            </ConfirmButton>
          </>
        }
      />
      {(redeliver.data || redeliver.error) && (
        <div className="mb-6">
          <Outcome title="Send again" result={redeliver.data} error={redeliver.error} />
        </div>
      )}
      <QueryView query={delivery} title="Delivery">
        {(d, res) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Delivery">
                <KeyValue
                  items={[
                    [
                      'Event',
                      <span key="t" className="font-mono text-xs">
                        {d.type}
                      </span>,
                    ],
                    ['Kind', d.kind],
                    ['Status', <StatusBadge key="s" value={d.status} tones={DELIVERY_TONES} />],
                    [
                      'Invoice',
                      d.invoiceId ? (
                        <Link
                          key="i"
                          to={`/invoices/${d.invoiceId}`}
                          className="font-mono text-xs underline underline-offset-4"
                        >
                          {d.invoiceId}
                        </Link>
                      ) : (
                        '—'
                      ),
                    ],
                    ['Attempts', `${d.attempts} in this cycle, ${d.totalAttempts} in all, cycle ${d.cycle}`],
                    ['Sent again', d.redeliveries],
                    ['Next attempt', formatTime(d.nextAttemptAt)],
                    ['Last answer', d.lastHttpStatus ?? d.lastErrorCode ?? '—'],
                    ['Last error', d.lastError ?? '—'],
                    ['Waiting because', d.waitReason ?? '—'],
                    ['Expired because', d.expiredReason ?? '—'],
                    ['Occurred', formatTime(d.occurredAt)],
                    ['Delivered', formatTime(d.deliveredAt)],
                    ['Failed', formatTime(d.failedAt)],
                    [
                      'Body sha256',
                      <span key="h" className="font-mono text-xs break-all">
                        {d.bodySha256}
                      </span>,
                    ],
                  ]}
                />
                <div className="mt-3">
                  <CallLine meta={res.meta} />
                </div>
              </Section>
              <Section title="Body">
                <CodeBlock value={prettyJson(d.body)} maxHeight="max-h-[28rem]" />
              </Section>
            </div>
            <Section title={`Attempts (${d.deliveryAttempts.length})`}>
              {d.deliveryAttempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attempts yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Attempt</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Answer</TableHead>
                      <TableHead>IP · duration</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.deliveryAttempts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatTime(a.startedAt)}</TableCell>
                        <TableCell className="text-xs">
                          {a.cycle}.{a.attemptNo}
                        </TableCell>
                        <TableCell className="text-xs">{a.status}</TableCell>
                        <TableCell>
                          {a.httpStatus ? (
                            <ToneBadge tone={httpTone(a.httpStatus)}>{a.httpStatus}</ToneBadge>
                          ) : (
                            (a.errorCode ?? '—')
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {a.resolvedIp ?? '—'} · {a.durationMs ?? '—'} ms
                        </TableCell>
                        <TableCell className="max-w-md">
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              headers and answer{a.signedWith ? ` · signed with the ${a.signedWith} secret` : ''}
                            </summary>
                            <div className="mt-2 flex flex-col gap-2">
                              <CodeBlock label="URL" value={a.url} maxHeight="max-h-16" />
                              <JsonBlock label="Request headers" value={a.requestHeaders} maxHeight="max-h-48" />
                              <CodeBlock
                                label="Response headers"
                                value={headersText(a.responseHeaders)}
                                maxHeight="max-h-40"
                              />
                              <CodeBlock label="Response body" value={a.responseBody ?? ''} maxHeight="max-h-40" />
                              {a.error && <p className="text-xs text-destructive">{a.error}</p>}
                            </div>
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          </div>
        )}
      </QueryView>
      <Section
        title="What this backend's receiver got"
        description="GET /api/received-webhooks?webhookId=…"
        className="mt-6"
      >
        <QueryView query={copies} title="Received webhooks">
          {(r) =>
            r.items.length ? (
              <ReceivedTable items={r.items} />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing with this webhook id reached the receiver.</p>
            )
          }
        </QueryView>
      </Section>
    </>
  );
}
