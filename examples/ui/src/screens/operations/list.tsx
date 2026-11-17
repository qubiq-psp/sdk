import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { callText } from '@/api/client';
import { apiKey, useApi, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { CallLine } from '@/components/app/call-info';
import { CodeBlock } from '@/components/app/code-block';
import { Field } from '@/components/app/field';
import { DateFilter, FilterBar, MultiFilter, TextFilter } from '@/components/app/filters';
import { Outcome } from '@/components/app/outcome';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { PairSelect } from '@/components/app/pair-select';
import { QueryView } from '@/components/app/query-view';
import { OPERATION_TYPES } from '@/lib/enums';
import { formatTime, shortId } from '@/lib/format';
import { listOf, useSearchState } from '@/lib/search-state';

const LIMIT = 25;

export function OperationsScreen() {
  const { values, set } = useSearchState(['tab'] as const);
  return (
    <>
      <PageHeader
        title="Operations"
        description="Every movement of the merchant's money: credits of payments, fees, payout holds and captures, adjustments."
      />
      <Tabs value={values.tab || 'list'} onValueChange={(v) => set({ tab: v === 'list' ? '' : v })}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="report">Summary and statement</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <OperationList />
        </TabsContent>
        <TabsContent value="report">
          <Report />
        </TabsContent>
      </Tabs>
    </>
  );
}

function OperationList() {
  const { values, set, page, setPage } = useSearchState([
    'tab',
    'pair',
    'type',
    'invoiceId',
    'payoutId',
    'crossNetworkPayoutId',
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
    ...(values.type ? { type: listOf(values.type) as (typeof OPERATION_TYPES)[number][] } : {}),
    ...(values.invoiceId ? { invoiceId: values.invoiceId } : {}),
    ...(values.payoutId ? { payoutId: values.payoutId } : {}),
    ...(values.crossNetworkPayoutId ? { crossNetworkPayoutId: values.crossNetworkPayoutId } : {}),
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
  };
  const list = useApi('listMerchantOperations', { query });
  return (
    <Section
      title="Operations"
      description="GET /api/operations"
      actions={
        <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listMerchantOperations', { query }))}>
          <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      }
    >
      <FilterBar
        onReset={() =>
          set({ pair: '', type: '', invoiceId: '', payoutId: '', crossNetworkPayoutId: '', from: '', to: '' })
        }
      >
        <Field label="Network and asset">
          {(p) => (
            <PairSelect id={p.id} pairs={pairs} value={values.pair} onChange={(v) => set({ pair: v })} allowAny />
          )}
        </Field>
        <TextFilter label="Invoice id" value={values.invoiceId} onChange={(v) => set({ invoiceId: v })} />
        <TextFilter label="Payout id" value={values.payoutId} onChange={(v) => set({ payoutId: v })} />
        <TextFilter
          label="Cross-network payout id"
          value={values.crossNetworkPayoutId}
          onChange={(v) => set({ crossNetworkPayoutId: v })}
        />
        <DateFilter label="Effective from" value={values.from} onChange={(v) => set({ from: v })} />
        <DateFilter label="Effective before" value={values.to} onChange={(v) => set({ to: v })} />
        <MultiFilter
          label="Type"
          options={OPERATION_TYPES}
          values={listOf(values.type)}
          onChange={(v) => set({ type: v.join(',') })}
        />
      </FilterBar>
      <QueryView query={list} title="Operations">
        {(o, res) => (
          <>
            {o.items.length === 0 ? (
              <Empty title="No operations" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Effective</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Network · asset</TableHead>
                    <TableHead className="text-right">Gross · fee · net</TableHead>
                    <TableHead className="text-right">Available after</TableHead>
                    <TableHead>For</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.items.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        <Link to={`/operations/${op.id}`} className="underline underline-offset-4">
                          {formatTime(op.effectiveAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {op.type} <span className="text-muted-foreground">({op.flow})</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {op.network} · {op.asset}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {op.gross ?? '—'} · {op.fee ?? '—'} · {op.net ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{op.availableAfter ?? '—'}</TableCell>
                      <TableCell className="text-xs">
                        {op.invoiceId ? (
                          <Link to={`/invoices/${op.invoiceId}`} className="underline underline-offset-4">
                            invoice {shortId(op.invoiceId)}
                          </Link>
                        ) : op.payoutId ? (
                          <Link to={`/payouts/${op.payoutId}`} className="underline underline-offset-4">
                            payout {shortId(op.payoutId)}
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
            <Pager page={o.page} limit={o.limit} total={o.total} onPage={setPage} />
            <div className="mt-3">
              <CallLine meta={res.meta} />
            </div>
          </>
        )}
      </QueryView>
    </Section>
  );
}

const DAY = 86_400_000;

/** The summary and the statement of a period: both need `from` and `to`. */
function Report() {
  const [range, setRange] = useState(() => ({
    from: new Date(Date.now() - 30 * DAY).toISOString(),
    to: new Date().toISOString(),
  }));
  const [pair, setPair] = useState('');
  const { pairs } = useReference();
  const [network, asset] = pair ? pair.split('/') : [];
  const query = { from: range.from, to: range.to, ...(network ? { network } : {}), ...(asset ? { asset } : {}) };
  const summary = useApi('getMerchantOperationsSummary', { query });
  const statement = useApi('getMerchantOperationsStatement', { query: { ...query, format: 'json' } });
  const csv = useMutation({
    mutationFn: () => callText('getMerchantOperationsStatement', { query: { ...query, format: 'csv' } }),
    onSuccess: (res) => {
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${range.from.slice(0, 10)}-${range.to.slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Section title="Period">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateFilter label="From" value={range.from} onChange={(v) => v && setRange((r) => ({ ...r, from: v }))} />
          <DateFilter label="To" value={range.to} onChange={(v) => v && setRange((r) => ({ ...r, to: v }))} />
          <Field label="Network and asset">
            {(p) => <PairSelect id={p.id} pairs={pairs} value={pair} onChange={setPair} allowAny />}
          </Field>
          <div className="flex items-end">
            <Button variant="outline" size="sm" disabled={csv.isPending} onClick={() => csv.mutate()}>
              <Download />
              Download statement (CSV)
            </Button>
          </div>
        </div>
        {(csv.data || csv.error) && (
          <div className="mt-3">
            <Outcome title="Statement CSV" result={csv.data} error={csv.error}>
              {(text) => (
                <CodeBlock
                  label="First lines"
                  value={text.split(/\r?\n/).slice(0, 6).join('\n')}
                  maxHeight="max-h-40"
                />
              )}
            </Outcome>
          </div>
        )}
      </Section>
      <Section title="Summary" description="GET /api/operations/summary">
        <QueryView query={summary} title="Summary">
          {(s, res) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Network · asset</TableHead>
                    <TableHead className="text-right">In: gross · fee · net</TableHead>
                    <TableHead className="text-right">Out: gross · fee · network fee</TableHead>
                    <TableHead className="text-right">Over · underpaid</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.items.map((i) => (
                    <TableRow key={`${i.network}/${i.asset}`}>
                      <TableCell className="text-xs">
                        {i.network} · {i.asset}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.inGross} · {i.inFee} · {i.inNet}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.outGross} · {i.outFee} · {i.outNetworkFee}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.overpaid} · {i.underpaid}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{i.available}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </>
          )}
        </QueryView>
      </Section>
      <Section title="Statement" description="GET /api/operations/statement?format=json">
        <QueryView query={statement} title="Statement">
          {(st, res) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Network · asset</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">In (net)</TableHead>
                    <TableHead className="text-right">Out (gross · fee · network fee)</TableHead>
                    <TableHead className="text-right">Holds · adjustments</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {st.items.map((i) => (
                    <TableRow key={`${i.network}/${i.asset}`}>
                      <TableCell className="text-xs">
                        {i.network} · {i.asset}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{i.opening}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{i.inNet}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.outGross} · {i.outFee} · {i.outNetworkFee}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.holdsChange} · {i.adjustments}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{i.closing}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </>
          )}
        </QueryView>
      </Section>
    </div>
  );
}
