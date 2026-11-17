import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { useApi } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { DEPOSIT_TONES, StatusBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { CopyValue } from '@/components/app/code-block';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { explorerTx } from '@/lib/networks';
import { formatTime } from '@/lib/format';

export function DepositScreen() {
  const { depositId = '' } = useParams();
  const deposit = useApi('getMerchantDeposit', { path: { depositId } });
  const { networks } = useReference();
  return (
    <>
      <PageHeader
        title="Deposit"
        description="GET /api/deposits/{depositId}"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/deposits">All deposits</Link>
          </Button>
        }
      />
      <QueryView query={deposit} title="Deposit">
        {(d, res) => {
          const template = networks.data?.data.items.find((n) => n.network === d.network)?.explorerTxUrl;
          const txUrl = explorerTx(template, d.txHash);
          return (
            <Section>
              <KeyValue
                items={[
                  ['Id', <CopyValue key="i" value={d.id} />],
                  ['Network', `${d.network} · ${d.chain}`],
                  ['Amount', `${d.amount} ${d.asset}`],
                  ['Fee · net', `${d.fee} · ${d.net}`],
                  ['State in the network', <StatusBadge key="s" value={d.status} tones={DEPOSIT_TONES} />],
                  ['Dropped because', d.dropReason ?? '—'],
                  ['Credit', d.creditStatus],
                  ['Match', d.matchKind ?? '—'],
                  ['AML', d.aml.status ?? '—'],
                  [
                    'Invoice',
                    d.invoiceId ? (
                      <Link
                        key="v"
                        to={`/invoices/${d.invoiceId}`}
                        className="font-mono text-xs underline underline-offset-4"
                      >
                        {d.invoiceId}
                      </Link>
                    ) : (
                      '—'
                    ),
                  ],
                  ['To address', <CopyValue key="a" value={d.address} />],
                  ['Memo', d.memo ?? '—'],
                  ['From address', <CopyValue key="f" value={d.fromAddress} />],
                  [
                    'Transaction',
                    txUrl ? (
                      <a
                        key="t"
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-xs break-all underline underline-offset-4"
                      >
                        {d.txHash}
                      </a>
                    ) : (
                      <CopyValue key="t" value={d.txHash} />
                    ),
                  ],
                  ['Block', `${d.blockNumber} at ${formatTime(d.blockTimestamp)}, event ${d.eventIndex}`],
                  ['Detected', formatTime(d.detectedAt)],
                  ['Confirmed', formatTime(d.confirmedAt)],
                  ['Credited', formatTime(d.creditedAt)],
                ]}
              />
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </Section>
          );
        }}
      </QueryView>
    </>
  );
}
