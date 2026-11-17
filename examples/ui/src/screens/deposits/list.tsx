import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiKey, useApi, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { DEPOSIT_TONES, StatusBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { Field } from '@/components/app/field';
import { DateFilter, EnumFilter, FilterBar, MultiFilter, TextFilter } from '@/components/app/filters';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { PairSelect } from '@/components/app/pair-select';
import { QueryView } from '@/components/app/query-view';
import { CREDIT_STATUSES, DEPOSIT_STATUSES, MATCH_KINDS } from '@/lib/enums';
import { formatTime, shortId } from '@/lib/format';
import { listOf, useSearchState } from '@/lib/search-state';

const LIMIT = 25;

export function DepositListScreen() {
  const { values, set, page, setPage } = useSearchState([
    'pair',
    'status',
    'creditStatus',
    'matchKind',
    'invoiceId',
    'txHash',
    'from',
    'to',
  ] as const);
  const { pairs } = useReference();
  const refresh = useRefresh();
  const [network, asset] = values.pair ? values.pair.split('/') : [];
  const query = {
    page,
    limit: LIMIT,
    ...(network ? { network } : {}),
    ...(asset ? { asset } : {}),
    ...(values.status ? { status: values.status as (typeof DEPOSIT_STATUSES)[number] } : {}),
    ...(values.creditStatus ? { creditStatus: listOf(values.creditStatus) as (typeof CREDIT_STATUSES)[number][] } : {}),
    ...(values.matchKind ? { matchKind: values.matchKind as (typeof MATCH_KINDS)[number] } : {}),
    ...(values.invoiceId ? { invoiceId: values.invoiceId } : {}),
    ...(values.txHash ? { txHash: values.txHash } : {}),
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
  };
  const list = useApi('listMerchantDeposits', { query });
  return (
    <>
      <PageHeader
        title="Deposits"
        description="GET /api/deposits — payments that arrived on the merchant's addresses, with how each was matched and credited."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listMerchantDeposits', { query }))}>
            <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />
      <Section>
        <FilterBar
          onReset={() =>
            set({ pair: '', status: '', creditStatus: '', matchKind: '', invoiceId: '', txHash: '', from: '', to: '' })
          }
        >
          <Field label="Network and asset">
            {(p) => (
              <PairSelect id={p.id} pairs={pairs} value={values.pair} onChange={(v) => set({ pair: v })} allowAny />
            )}
          </Field>
          <EnumFilter
            label="Network state"
            value={values.status}
            options={DEPOSIT_STATUSES}
            onChange={(v) => set({ status: v })}
          />
          <EnumFilter
            label="Match"
            value={values.matchKind}
            options={MATCH_KINDS}
            onChange={(v) => set({ matchKind: v })}
          />
          <TextFilter label="Invoice id" value={values.invoiceId} onChange={(v) => set({ invoiceId: v })} />
          <TextFilter label="Transaction hash" value={values.txHash} onChange={(v) => set({ txHash: v })} />
          <DateFilter label="From" value={values.from} onChange={(v) => set({ from: v })} />
          <DateFilter label="Before" value={values.to} onChange={(v) => set({ to: v })} />
          <MultiFilter
            label="Credit"
            options={CREDIT_STATUSES}
            values={listOf(values.creditStatus)}
            onChange={(v) => set({ creditStatus: v.join(',') })}
          />
        </FilterBar>
        <QueryView query={list} title="Deposits">
          {(d, res) => (
            <>
              {d.items.length === 0 ? (
                <Empty title="No deposits" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block time</TableHead>
                      <TableHead>Network · asset</TableHead>
                      <TableHead className="text-right">Amount · net</TableHead>
                      <TableHead>State · credit</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Invoice</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.items.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          <Link to={`/deposits/${x.id}`} className="underline underline-offset-4">
                            {formatTime(x.blockTimestamp)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">
                          {x.network} · {x.asset}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {x.amount} · {x.net}
                        </TableCell>
                        <TableCell className="text-xs">
                          <StatusBadge value={x.status} tones={DEPOSIT_TONES} /> {x.creditStatus}
                        </TableCell>
                        <TableCell className="text-xs">{x.matchKind ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {x.invoiceId ? (
                            <Link to={`/invoices/${x.invoiceId}`} className="underline underline-offset-4">
                              {shortId(x.invoiceId)}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pager page={d.page} limit={d.limit} total={d.total} onPage={setPage} />
              {d.totals.length > 0 && (
                <div className="mt-4">
                  <h2 className="mb-2 text-sm font-semibold">Totals of the filter</h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Network · asset</TableHead>
                        <TableHead className="text-right">Count · credited</TableHead>
                        <TableHead className="text-right">Amount · fee · net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.totals.map((t) => (
                        <TableRow key={`${t.network}/${t.asset}`}>
                          <TableCell className="text-xs">
                            {t.network} · {t.asset}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {t.count} · {t.creditedCount}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {t.amount} · {t.fee} · {t.net}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}
