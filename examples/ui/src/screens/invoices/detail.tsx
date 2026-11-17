import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppWindow, ExternalLink, RefreshCw, Repeat, XCircle } from 'lucide-react';
import type { components } from '@psp-examples/contract/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { call } from '@/api/client';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { FINAL_INVOICE_STATUSES, INVOICE_TONES, StatusBadge, ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { CopyValue, JsonBlock } from '@/components/app/code-block';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Countdown } from '@/components/app/countdown';
import { Field } from '@/components/app/field';
import { Outcome } from '@/components/app/outcome';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { QrCode } from '@/components/app/qr-code';
import { QueryView } from '@/components/app/query-view';
import { ReceivedTable } from '@/screens/received/table';
import { DeliveryTable } from '@/screens/webhooks/delivery-table';
import { explorerTx, networkLabel } from '@/lib/networks';
import { formatTime, shortId } from '@/lib/format';
import { CheckoutPanel } from './checkout-panel';
import type { InvoicePrefill } from './new';

type Invoice = components['schemas']['V1InvoiceWithPayments'];

const POLL_MS = 5000;

export function InvoiceDetailScreen() {
  const { invoiceId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [widget, setWidget] = useState(false);
  const [eventsPage, setEventsPage] = useState(1);
  const [reason, setReason] = useState('Cancelled in the example UI');

  // Auto-refresh while the invoice can still change; a final status never changes again
  const cached = qc.getQueryData<{ data: Invoice }>(apiKey('getInvoice', { path: { invoiceId } }));
  const final = cached ? FINAL_INVOICE_STATUSES.has(cached.data.status) : false;
  const pollMs = final ? false : POLL_MS;
  const invoice = useApi('getInvoice', { path: { invoiceId } }, { pollMs });
  const events = useApi(
    'listInvoiceEvents',
    { path: { invoiceId }, query: { page: eventsPage, limit: 20 } },
    { pollMs },
  );
  const received = useApi('listReceivedWebhooks', { query: { invoiceId, limit: 50 } });
  const deliveries = useApi('listDeliveries', { query: { invoiceId, limit: 50 } });
  const { pairs } = useReference();

  const cancel = useMutation({
    mutationFn: () => call('cancelInvoice', { path: { invoiceId }, body: reason ? { reason } : {} }),
    onSettled: () => invalidateOps(qc, 'getInvoice', 'listInvoiceEvents', 'listInvoices'),
  });

  const inv = invoice.data?.data;
  const open = inv ? !FINAL_INVOICE_STATUSES.has(inv.status) : false;
  const asset = pairs.find((p) => p.network === inv?.network && p.asset === inv.asset);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>Invoice</span>
            {inv && <span className="font-mono">{inv.externalId}</span>}
            {inv && <StatusBadge value={inv.status} tones={INVOICE_TONES} />}
            {open && <ToneBadge tone="muted">refreshes every 5 s</ToneBadge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-1">
            GET /api/invoices/{'{invoiceId}'} · <CopyValue value={invoiceId} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh(['getInvoice'])}>
              <RefreshCw className={invoice.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <Button
              variant={widget ? 'secondary' : 'outline'}
              size="sm"
              aria-expanded={widget}
              disabled={!inv}
              onClick={() => setWidget((v) => !v)}
            >
              <AppWindow />
              Payment widget
            </Button>
            {inv && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate('/invoices/new', {
                    state: {
                      network: inv.network,
                      asset: inv.asset,
                      amount: inv.amount,
                      description: inv.description ?? '',
                      metadata: inv.metadata ? JSON.stringify(inv.metadata) : '',
                    } satisfies InvoicePrefill,
                  })
                }
              >
                <Repeat />
                Create one like this
              </Button>
            )}
          </>
        }
      />

      {widget && inv && <CheckoutPanel invoice={inv} onClose={() => setWidget(false)} className="mb-6" />}

      <QueryView query={invoice} title="Invoice">
        {(i, res) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Payment">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <QrCode value={i.address} />
                  <div className="min-w-0 flex-1">
                    <KeyValue
                      items={[
                        ['Address', <CopyValue key="a" value={i.address} />],
                        ['Left to pay', <CopyValue key="r" value={i.remaining} />],
                        ['Invoice amount', `${i.amount} ${i.asset}`],
                        ['Network', `${networkLabel(i.network)} · ${i.chain}`],
                        ...(asset?.contract
                          ? ([['Token contract', <CopyValue key="c" value={asset.contract} />]] as [
                              ReactNode,
                              ReactNode,
                            ][])
                          : []),
                        ...(i.memo
                          ? ([['Memo', <CopyValue key="m" value={i.memo} />]] as [ReactNode, ReactNode][])
                          : []),
                        [
                          'Payment window',
                          <span key="w">
                            until {formatTime(i.expiresAt)} · {open ? <Countdown until={i.expiresAt} /> : 'closed'}
                          </span>,
                        ],
                      ]}
                    />
                  </div>
                </div>
                {open && asset?.family === 'evm' && (
                  <p className="mt-4 rounded-md border border-status-warning-border bg-status-warning-bg p-2 text-xs text-status-warning-fg">
                    Pay only in {networkLabel(i.network)}: the 0x… address is the same in every EVM network, and a
                    payment in another network is not seen by this invoice.
                  </p>
                )}
              </Section>
              <Section title="Amounts and status">
                <AmountsView invoice={i} />
              </Section>
            </div>

            <Section title={`Payments (${i.payments.length})`}>
              {i.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block time</TableHead>
                      <TableHead>Transaction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead>Deposit · credit</TableHead>
                      <TableHead>Match · result</TableHead>
                      <TableHead>AML</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {i.payments.map((p) => {
                      const txUrl = explorerTx(asset?.explorerTxUrl, p.txHash);
                      return (
                        <TableRow key={`${p.txHash}:${p.eventIndex}`}>
                          <TableCell className="text-xs whitespace-nowrap">{formatTime(p.blockTimestamp)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {txUrl ? (
                              <a
                                href={txUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 underline underline-offset-4"
                              >
                                {shortId(p.txHash)}{' '}
                                <ExternalLink className="size-3" aria-label="(opens the explorer)" />
                              </a>
                            ) : (
                              shortId(p.txHash)
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{p.amount}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{p.applied}</TableCell>
                          <TableCell className="text-xs">
                            <Link to={`/deposits/${p.depositId}`} className="underline underline-offset-4">
                              {p.depositStatus}
                            </Link>{' '}
                            · {p.creditStatus}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.matchKind} · {p.result ?? '—'}
                            {p.dropReason ? ` · ${p.dropReason}` : ''}
                          </TableCell>
                          <TableCell className="text-xs">{p.aml.status ?? '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Section>

            <Section
              title="Cancel"
              description="POST /api/invoices/{invoiceId}/cancel — only an invoice without payments"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Reason (optional, up to 500 characters)" className="flex-1">
                  {(p) => <Input {...p} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <ConfirmButton
                  title="Cancel this invoice?"
                  description="The buyer can no longer pay it. The platform refuses when payments have already arrived."
                  confirmLabel="Cancel the invoice"
                  destructive
                  disabled={!open || cancel.isPending}
                  onConfirm={() => cancel.mutate()}
                >
                  <XCircle />
                  Cancel invoice
                </ConfirmButton>
              </div>
              <div className="mt-3">
                <Outcome title="Cancel" result={cancel.data} error={cancel.error} />
              </div>
            </Section>

            <Section title="Last answer" description="How the invoice above was read">
              <CallLine meta={res.meta} />
            </Section>
          </div>
        )}
      </QueryView>

      <Section title="History" description="GET /api/invoices/{invoiceId}/events" className="mt-6">
        <QueryView query={events} title="Invoice events">
          {(e) => (
            <>
              {e.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.items.map((ev) => (
                      <TableRow key={ev.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatTime(ev.occurredAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{ev.type}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {ev.statusFrom ?? '—'} → {ev.statusTo ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-md">
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">payload</summary>
                            <JsonBlock value={ev.payload} maxHeight="max-h-64" />
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pager page={e.page} limit={e.limit} total={e.total} onPage={setEventsPage} />
            </>
          )}
        </QueryView>
      </Section>

      <div className="mt-6 grid gap-6 2xl:grid-cols-2">
        <Section
          title="Webhooks the receiver got for this invoice"
          description="GET /api/received-webhooks?invoiceId=…"
        >
          <QueryView query={received} title="Received webhooks">
            {(r) =>
              r.items.length ? (
                <ReceivedTable items={r.items} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  None yet. Check that the webhook URL points to this backend:{' '}
                  <Link to="/webhooks" className="underline underline-offset-4">
                    Webhook settings
                  </Link>
                  .
                </p>
              )
            }
          </QueryView>
        </Section>
        <Section title="Platform deliveries for this invoice" description="GET /api/webhook/deliveries?invoiceId=…">
          <QueryView query={deliveries} title="Deliveries">
            {(d) =>
              d.items.length ? (
                <DeliveryTable items={d.items} />
              ) : (
                <p className="text-sm text-muted-foreground">No deliveries.</p>
              )
            }
          </QueryView>
        </Section>
      </div>
    </>
  );
}

function AmountsView({ invoice: i }: { invoice: Invoice }) {
  const a = i.asset;
  return (
    <KeyValue
      items={[
        ['Received', `${i.received} ${a}`],
        ['Waiting for confirmation', `${i.pending} ${a}`],
        ['Held by AML', `${i.held} ${a}`],
        ['Left to pay', `${i.remaining} ${a}`],
        ['Overpaid', `${i.overpaid} ${a}`],
        ['Underpaid', `${i.underpaid} ${a}`],
        ['Arrived after the window', `${i.lateReceived} ${a}`],
        ['Status reason', i.statusReason ?? '—'],
        ['Window extensions', `${i.extendedCount} of ${i.maxUnderpaymentResets}`],
        ['Created', formatTime(i.createdAt)],
        ['Paid', formatTime(i.paidAt)],
        ['Closed', formatTime(i.closedAt)],
        ['Cancelled', formatTime(i.cancelledAt)],
        ['Payments checked until', formatTime(i.paymentsCheckedUntil)],
        ['Monitoring delayed', i.monitoringDelayed ? 'yes' : 'no'],
        ['Description', i.description ?? '—'],
        [
          'Metadata',
          i.metadata ? (
            <span key="m" className="font-mono text-xs">
              {JSON.stringify(i.metadata)}
            </span>
          ) : (
            '—'
          ),
        ],
      ]}
    />
  );
}
