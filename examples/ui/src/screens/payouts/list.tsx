import { Link } from 'react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiKey, useApi, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { PAYOUT_TONES, StatusBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { Field } from '@/components/app/field';
import { DateFilter, FilterBar, MultiFilter, TextFilter } from '@/components/app/filters';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { PairSelect } from '@/components/app/pair-select';
import { QueryView } from '@/components/app/query-view';
import { PAYOUT_STATUSES } from '@/lib/enums';
import { formatTime } from '@/lib/format';
import { listOf, useSearchState } from '@/lib/search-state';

const LIMIT = 20;

export function PayoutListScreen() {
  const { values, set, page, setPage } = useSearchState(['status', 'externalId', 'pair', 'from', 'to'] as const);
  const { pairs } = useReference();
  const refresh = useRefresh();
  const [network, asset] = values.pair ? values.pair.split('/') : [];
  const query = {
    page,
    limit: LIMIT,
    ...(values.status ? { status: listOf(values.status) as (typeof PAYOUT_STATUSES)[number][] } : {}),
    ...(values.externalId ? { externalId: values.externalId } : {}),
    ...(network ? { network } : {}),
    ...(asset ? { asset } : {}),
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
  };
  const list = useApi('listPayouts', { query });
  return (
    <>
      <PageHeader
        title="Payouts"
        description="GET /api/payouts — withdrawals from the merchant's balance to an outside address."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listPayouts', { query }))}>
              <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link to="/payouts/new">
                <Plus />
                New payout
              </Link>
            </Button>
          </>
        }
      />
      <Section>
        <FilterBar onReset={() => set({ status: '', externalId: '', pair: '', from: '', to: '' })}>
          <TextFilter label="External id" value={values.externalId} onChange={(v) => set({ externalId: v })} />
          <Field label="Network and asset">
            {(p) => (
              <PairSelect id={p.id} pairs={pairs} value={values.pair} onChange={(v) => set({ pair: v })} allowAny />
            )}
          </Field>
          <DateFilter label="Created from" value={values.from} onChange={(v) => set({ from: v })} />
          <DateFilter label="Created before" value={values.to} onChange={(v) => set({ to: v })} />
          <MultiFilter
            label="Status"
            options={PAYOUT_STATUSES}
            values={listOf(values.status)}
            onChange={(v) => set({ status: v.join(',') })}
          />
        </FilterBar>
        <QueryView query={list} title="Payouts">
          {(d, res) => (
            <>
              {d.items.length === 0 ? (
                <Empty title="No payouts" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>External id</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount · fee</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.items.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">
                          <Link to={`/payouts/${p.id}`} className="underline underline-offset-4">
                            {p.externalId}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge value={p.status} tones={PAYOUT_TONES} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {p.amount} {p.asset} · {p.fee}
                        </TableCell>
                        <TableCell className="max-w-48 font-mono text-xs break-all">
                          {p.network}: {p.toAddress}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatTime(p.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pager page={d.page} limit={d.limit} total={d.total} onPage={setPage} />
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
