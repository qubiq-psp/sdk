import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiKey, useRefresh } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';

const onOff = (on: boolean) => <ToneBadge tone={on ? 'success' : 'neutral'}>{on ? 'on' : 'off'}</ToneBadge>;

export function NetworksScreen() {
  const { networks, tariff } = useReference();
  const refresh = useRefresh();
  return (
    <>
      <PageHeader
        title="Networks and tariff"
        description="What the merchant can take payments in and pay out, and what it costs. The invoice and payout forms take their choices and limits from here."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh(apiKey('listNetworks'));
              void refresh(apiKey('getMerchantTariff'));
            }}
          >
            <RefreshCw className={networks.isFetching || tariff.isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />
      <Section title="Networks and assets" description="GET /api/networks">
        <QueryView query={networks} title="Networks">
          {(n, res) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Network · chain</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Standard · contract</TableHead>
                    <TableHead className="text-right">Decimals</TableHead>
                    <TableHead>Invoices</TableHead>
                    <TableHead>Payouts</TableHead>
                    <TableHead className="text-right">Smallest credited</TableHead>
                    <TableHead className="text-right">Payout limits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {n.items.flatMap((net) =>
                    net.assets.map((a) => (
                      <TableRow key={`${net.network}/${a.asset}`}>
                        <TableCell className="text-xs">
                          {net.network} · {net.chain} <span className="text-muted-foreground">({net.family})</span>
                        </TableCell>
                        <TableCell className="text-xs">{a.asset}</TableCell>
                        <TableCell className="max-w-48 font-mono text-xs break-all">
                          {a.standard}
                          {a.contract ? ` · ${a.contract}` : ''}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.decimals}</TableCell>
                        <TableCell>{onOff(net.invoicesEnabled && a.invoicesEnabled)}</TableCell>
                        <TableCell>{onOff(net.payoutsEnabled && a.payoutsEnabled)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.minCreditAmount}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {a.payoutMin ?? '—'} … {a.payoutMax ?? '—'}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
              <div className="mt-3">
                <CallLine meta={res.meta} />
              </div>
            </>
          )}
        </QueryView>
      </Section>
      <Section title="Tariff" description="GET /api/tariff" className="mt-6">
        <QueryView query={tariff} title="Tariff">
          {(t, res) => (
            <>
              <p className="mb-3 text-sm">
                Plan <strong>{t.tariffPlanName}</strong>, as of {formatTime(t.asOf)}.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead>Applies to</TableHead>
                    <TableHead className="text-right">Percent</TableHead>
                    <TableHead className="text-right">Fixed</TableHead>
                    <TableHead className="text-right">Min · max fee</TableHead>
                    <TableHead className="text-right">Invoice amount</TableHead>
                    <TableHead>Valid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.rules.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{r.operationType}</TableCell>
                      <TableCell className="text-xs">
                        {[r.network, r.asset ?? r.currency].filter(Boolean).join(' · ') || 'everything'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.percent}%</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.fixed} <span className="text-muted-foreground">per {r.fixedScope}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.minFee} · {r.maxFee ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.invoiceMin || r.invoiceMax ? `${r.invoiceMin ?? '—'} … ${r.invoiceMax ?? '—'}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatTime(r.validFrom)} → {r.validTo ? formatTime(r.validTo) : 'open'}
                      </TableCell>
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
    </>
  );
}
