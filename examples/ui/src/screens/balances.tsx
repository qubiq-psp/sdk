import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiKey, useApi, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { CallLine } from '@/components/app/call-info';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filters';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { PairSelect } from '@/components/app/pair-select';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';
import { useSearchState } from '@/lib/search-state';

export function BalancesScreen() {
  const { values, set } = useSearchState(['pair'] as const);
  const { pairs } = useReference();
  const [network, asset] = values.pair ? values.pair.split('/') : [];
  const query = { ...(network ? { network } : {}), ...(asset ? { asset } : {}) };
  const balances = useApi('getMerchantBalances', { query });
  const refresh = useRefresh();
  return (
    <>
      <PageHeader
        title="Balances"
        description="GET /api/balances — what the merchant holds per network and asset, and per currency over all networks."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('getMerchantBalances', { query }))}>
            <RefreshCw className={balances.isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />
      <Section>
        <FilterBar onReset={() => set({ pair: '' })}>
          <Field label="Network and asset">
            {(p) => (
              <PairSelect id={p.id} pairs={pairs} value={values.pair} onChange={(v) => set({ pair: v })} allowAny />
            )}
          </Field>
        </FilterBar>
        <QueryView query={balances} title="Balances">
          {(b, res) => (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="mb-2 text-sm font-semibold">By network and asset</h2>
                {b.items.length === 0 ? (
                  <Empty title="No balances" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Network · asset</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">AML hold</TableHead>
                        <TableHead className="text-right">Payout hold</TableHead>
                        <TableHead className="text-right">Frozen</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.items.map((i) => (
                        <TableRow key={`${i.network}/${i.asset}`}>
                          <TableCell className="text-xs">
                            {i.network} · {i.asset}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.available}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.amlHold}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.payoutHold}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.frozen}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.total}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold">By currency</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">On hold</TableHead>
                      <TableHead className="text-right">Frozen</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Networks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.byCurrency.map((c) => (
                      <TableRow key={c.currency}>
                        <TableCell className="text-xs">{c.currency}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.available}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {c.amlHold} + {c.payoutHold}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.frozen}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.total}</TableCell>
                        <TableCell className="text-xs">{c.networks.join(', ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">As of {formatTime(b.asOf)}.</p>
              <CallLine meta={res.meta} />
            </div>
          )}
        </QueryView>
      </Section>
    </>
  );
}
