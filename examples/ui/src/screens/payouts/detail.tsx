import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/api/client';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { FINAL_PAYOUT_STATUSES, PAYOUT_TONES, StatusBadge, ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { CopyValue, JsonBlock } from '@/components/app/code-block';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Field } from '@/components/app/field';
import { Outcome } from '@/components/app/outcome';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';

export function PayoutScreen() {
  const { payoutId = '' } = useParams();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const key = apiKey('getPayout', { path: { payoutId } });
  const cached = qc.getQueryData<{ data: { status: string } }>(key);
  const final = cached ? FINAL_PAYOUT_STATUSES.has(cached.data.status) : false;
  const payout = useApi('getPayout', { path: { payoutId } }, { pollMs: final ? false : 10_000 });
  const [reason, setReason] = useState('Cancelled in the example UI');
  const cancel = useMutation({
    mutationFn: () => call('cancelPayout', { path: { payoutId }, body: reason ? { reason } : {} }),
    onSettled: () => invalidateOps(qc, 'getPayout', 'listPayouts'),
  });
  const p = payout.data?.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Payout {p && <span className="font-mono">{p.externalId}</span>}
            {p && <StatusBadge value={p.status} tones={PAYOUT_TONES} />}
            {p && !final && <ToneBadge tone="muted">refreshes every 10 s</ToneBadge>}
          </span>
        }
        description="GET /api/payouts/{payoutId}"
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/operations?payoutId=${payoutId}`}>Its operations</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refresh(key)}>
              <RefreshCw className={payout.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </>
        }
      />
      <QueryView query={payout} title="Payout">
        {(x, res) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Payout">
                <KeyValue
                  items={[
                    ['Id', <CopyValue key="i" value={x.id} />],
                    ['Amount', `${x.amount} ${x.asset}`],
                    ['Fee · total', `${x.fee} · ${x.total}`],
                    ['Network fee charged', x.networkFeeCharged ?? '—'],
                    ['Balance charged', x.debits.map((d) => `${d.amount} ${d.asset}`).join(' + ') || '—'],
                    ['To', <CopyValue key="t" value={x.toAddress} />],
                    ['Network', x.network],
                    ['Memo', x.memo ?? '—'],
                    ['Transaction', x.txHash ? <CopyValue key="h" value={x.txHash} /> : '—'],
                    ['Block', x.blockNumber ?? '—'],
                    [
                      'Failed at · because',
                      x.failureStage || x.failureReason ? `${x.failureStage ?? '—'} · ${x.failureReason ?? '—'}` : '—',
                    ],
                    ['Retry of', x.retryOfId ?? '—'],
                    ['Quote', x.quoteId ?? '—'],
                    ['Reason', x.reason ?? '—'],
                  ]}
                />
              </Section>
              <Section title="Timeline">
                <KeyValue
                  items={[
                    ['Created', formatTime(x.createdAt)],
                    ['Approved', formatTime(x.approvedAt)],
                    ['Dispatched', formatTime(x.dispatchedAt)],
                    ['Submitted', formatTime(x.submittedAt)],
                    ['Confirmed', formatTime(x.confirmedAt)],
                    ['Failed', formatTime(x.failedAt)],
                    ['Rejected', formatTime(x.rejectedAt)],
                    ['Cancelled', formatTime(x.cancelledAt)],
                    ['Expires', formatTime(x.expiresAt)],
                  ]}
                />
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Network fee</summary>
                  <JsonBlock value={x.networkFee} maxHeight="max-h-60" />
                </details>
              </Section>
            </div>
            <Section
              title="Cancel"
              description="POST /api/payouts/{payoutId}/cancel — only before the payout is sent to the network"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Reason (optional, up to 500 characters)" className="flex-1">
                  {(f) => <Input {...f} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <ConfirmButton
                  title="Cancel this payout?"
                  description="The hold on the balance is released. The platform refuses once the payout is on its way."
                  confirmLabel="Cancel the payout"
                  destructive
                  disabled={FINAL_PAYOUT_STATUSES.has(x.status) || cancel.isPending}
                  onConfirm={() => cancel.mutate()}
                >
                  <XCircle />
                  Cancel payout
                </ConfirmButton>
              </div>
              <div className="mt-3">
                <Outcome title="Cancel" result={cancel.data} error={cancel.error} />
              </div>
            </Section>
            <CallLine meta={res.meta} />
          </div>
        )}
      </QueryView>
    </>
  );
}
