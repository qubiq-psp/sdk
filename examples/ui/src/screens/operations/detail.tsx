import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { useApi } from '@/api/hooks';
import { CallLine } from '@/components/app/call-info';
import { CopyValue, JsonBlock } from '@/components/app/code-block';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';

const link = (to: string, id: string | null) =>
  id ? (
    <Link to={to} className="font-mono text-xs underline underline-offset-4">
      {id}
    </Link>
  ) : (
    '—'
  );

export function OperationScreen() {
  const { operationId = '' } = useParams();
  const op = useApi('getMerchantOperation', { path: { operationId } });
  return (
    <>
      <PageHeader
        title="Operation"
        description="GET /api/operations/{operationId}"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/operations">All operations</Link>
          </Button>
        }
      />
      <QueryView query={op} title="Operation">
        {(o, res) => (
          <div className="grid gap-6 xl:grid-cols-2">
            <Section title={<span className="font-mono">{o.type}</span>}>
              <KeyValue
                items={[
                  ['Id', <CopyValue key="i" value={o.id} />],
                  ['Flow', o.flow],
                  ['Network · asset', `${o.network} · ${o.asset}`],
                  ['Gross', o.gross ?? '—'],
                  ['Fee', o.fee ?? '—'],
                  ['Net', o.net ?? '—'],
                  ['Available after', o.availableAfter ?? '—'],
                  ['Payment kind · result', `${o.paymentKind ?? '—'} · ${o.paymentResult ?? '—'}`],
                  ['Match', o.matchKind ?? '—'],
                  ['Expected · difference', `${o.expected ?? '—'} · ${o.delta ?? '—'}`],
                  ['Invoice', link(`/invoices/${o.invoiceId ?? ''}`, o.invoiceId)],
                  ['Deposit', link(`/deposits/${o.depositId ?? ''}`, o.depositId)],
                  ['Payout', link(`/payouts/${o.payoutId ?? ''}`, o.payoutId)],
                  ['Cross-network payout', o.crossNetworkPayoutId ?? '—'],
                  ['Transaction', o.txHash ? <CopyValue key="t" value={o.txHash} /> : '—'],
                  ['Effective', formatTime(o.effectiveAt)],
                  ['Posted', formatTime(o.postedAt)],
                ]}
              />
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </Section>
            <div className="flex min-w-0 flex-col gap-6">
              {o.feeDetails && (
                <Section title="Fee">
                  <JsonBlock value={o.feeDetails} maxHeight="max-h-60" />
                </Section>
              )}
              {o.networkFee && (
                <Section title="Network fee">
                  <JsonBlock value={o.networkFee} maxHeight="max-h-60" />
                </Section>
              )}
              {o.destination && (
                <Section title="Destination">
                  <JsonBlock value={o.destination} maxHeight="max-h-60" />
                </Section>
              )}
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
