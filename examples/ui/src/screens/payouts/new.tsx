import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Dices, Repeat, Send } from 'lucide-react';
import type { components } from '@psp-examples/contract/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { call } from '@/api/client';
import { invalidateOps } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { ErrorView } from '@/components/app/api-error';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Countdown } from '@/components/app/countdown';
import { Field } from '@/components/app/field';
import { Outcome } from '@/components/app/outcome';
import { KeyValue, Loading, PageHeader, Section } from '@/components/app/page';
import { PairSelect } from '@/components/app/pair-select';
import { amountProblem, limitWarning, newExternalId } from '@/lib/decimal';
import { formatTime } from '@/lib/format';

type CreateBody = components['schemas']['createPayoutBody'];
type Quote = components['schemas']['V1PayoutQuote'];

const amounts = (list: { asset: string; amount: string }[]) =>
  list.map((a) => `${a.amount} ${a.asset}`).join(' + ') || '—';

export function PayoutNewScreen() {
  const qc = useQueryClient();
  const { networks, pairs } = useReference();
  const payoutPairs = pairs.filter((p) => p.payoutsEnabled);
  const [pair, setPair] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [externalId, setExternalId] = useState(() => newExternalId('payout'));
  const [useQuote, setUseQuote] = useState(true);

  const selected = payoutPairs.find((p) => p.key === pair) ?? payoutPairs[0];
  const amountError = amount ? amountProblem(amount, selected) : null;
  const amountWarning = limitWarning(amount, selected?.payoutMin, selected?.payoutMax);

  const quote = useMutation({
    mutationFn: () =>
      call('quotePayout', {
        body: {
          network: selected?.network ?? '',
          asset: selected?.asset ?? '',
          toAddress: toAddress.trim(),
          ...(amount ? { amount } : {}),
        },
      }),
  });
  const q: Quote | undefined = quote.data?.data;
  const quoteMatches =
    q !== undefined &&
    q.network === selected?.network &&
    q.asset === selected.asset &&
    q.toAddress === toAddress.trim();

  const body = (): CreateBody => ({
    externalId: externalId.trim(),
    network: selected?.network ?? '',
    asset: selected?.asset ?? '',
    amount,
    toAddress: toAddress.trim(),
    ...(memo ? { memo } : {}),
    ...(useQuote && quoteMatches ? { quoteId: q.quoteId } : {}),
  });
  const create = useMutation({
    mutationFn: (payload: CreateBody) => call('createPayout', { body: payload }),
    onSettled: () => invalidateOps(qc, 'listPayouts', 'getMerchantBalances'),
  });
  const created = create.data?.data;
  const canCreate =
    selected !== undefined && toAddress.trim() !== '' && amount !== '' && !amountError && externalId.trim() !== '';

  return (
    <>
      <PageHeader
        title="New payout"
        description="Get a quote (POST /api/payouts/quote: the fee, the network fee and the limits — at most 10 quotes a minute), then create the payout (POST /api/payouts). The same externalId returns the same payout (200), so a timed-out create is safe to repeat."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/payouts">All payouts</Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
        <Section title="Payout">
          {networks.isPending && <Loading text="Loading networks…" />}
          {networks.error && <ErrorView error={networks.error} title="Networks" />}
          <div className="flex flex-col gap-4">
            <Field
              label="Network and asset"
              hint={
                selected &&
                `Payout limits ${selected.payoutMin ?? '—'} … ${selected.payoutMax ?? '—'} ${selected.asset}, ${selected.decimals} decimals`
              }
            >
              {(p) => (
                <PairSelect
                  id={p.id}
                  describedBy={p['aria-describedby']}
                  pairs={payoutPairs}
                  value={selected?.key ?? ''}
                  onChange={setPair}
                />
              )}
            </Field>
            <Field label="To address" hint="An address outside the platform, up to 128 characters">
              {(p) => (
                <Input
                  {...p}
                  value={toAddress}
                  className="font-mono text-xs"
                  onChange={(e) => setToAddress(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Amount"
              hint="For a quote it may stay empty: the quote then shows the largest possible amount"
              error={amountError}
              warning={amountWarning && `${amountWarning}: you can still send it, the platform decides`}
            >
              {(p) => (
                <Input
                  {...p}
                  value={amount}
                  inputMode="decimal"
                  className="font-mono"
                  onChange={(e) => setAmount(e.target.value.trim())}
                />
              )}
            </Field>
            <Field label="Memo (optional)" hint="Up to 128 characters, for networks that use one">
              {(p) => <Input {...p} value={memo} maxLength={128} onChange={(e) => setMemo(e.target.value)} />}
            </Field>
            <Field label="External id" hint="Your id of this payout: repeat it to test idempotency">
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    value={externalId}
                    maxLength={128}
                    className="font-mono"
                    onChange={(e) => setExternalId(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="New external id"
                    title="New external id"
                    onClick={() => setExternalId(newExternalId('payout'))}
                  >
                    <Dices />
                  </Button>
                </div>
              )}
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id="use-quote" checked={useQuote} onCheckedChange={(c) => setUseQuote(c === true)} />
              <Label htmlFor="use-quote" className="font-normal">
                Create with the quote id (when the quote matches the form)
              </Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!selected || !toAddress.trim() || Boolean(amountError) || quote.isPending}
                onClick={() => quote.mutate()}
              >
                <Calculator />
                Get quote
              </Button>
              <ConfirmButton
                variant="default"
                size="default"
                title="Send this payout?"
                description={
                  <span className="flex flex-col gap-2">
                    <span>
                      {amount} {selected?.asset} to{' '}
                      <span className="font-mono text-xs break-all">{toAddress.trim()}</span> in {selected?.network}.
                    </span>
                    {q && quoteMatches && useQuote && (
                      <span>The quote says the balance is charged {amounts(q.debits)}.</span>
                    )}
                    <span>Funds leave the merchant's balance; on testnet they are test coins.</span>
                  </span>
                }
                confirmLabel="Send payout"
                disabled={!canCreate || create.isPending}
                onConfirm={() => create.mutate(body())}
              >
                <Send />
                Create payout
              </ConfirmButton>
              <Button
                variant="outline"
                disabled={!create.data || create.isPending}
                title="The same externalId and body: expect 200 and the same payout"
                onClick={() => create.mutate(body())}
              >
                <Repeat />
                Repeat
              </Button>
            </div>
            {create.isPending && (
              <Loading text="Waiting for the platform: a payout may take up to 180 s per attempt; the request log shows each attempt." />
            )}
          </div>
        </Section>
        <div className="flex min-w-0 flex-col gap-4">
          <Outcome title="Quote" result={quote.data} error={quote.error}>
            {(r) => (
              <KeyValue
                items={[
                  [
                    'Quote id',
                    <span key="q" className="font-mono text-xs">
                      {r.quoteId}
                    </span>,
                  ],
                  [
                    'Valid until',
                    <span key="e">
                      {formatTime(r.expiresAt)} · <Countdown until={r.expiresAt} />
                    </span>,
                  ],
                  ['Amount · largest possible', `${r.amount} · ${r.maxAmount} ${r.asset}`],
                  ['Commission', `${r.commission} ${r.asset}`],
                  ['Network fee', `${r.networkFee.amount} ${r.networkFee.asset} (${r.networkFee.source})`],
                  ['Balance is charged', amounts(r.debits)],
                  ['Available', amounts(r.available)],
                  [
                    'Limits',
                    `${r.limits.min} … ${r.limits.max}; today ${r.limits.dailyUsed} of ${r.limits.dailyLimit}, ${r.limits.dailyRemaining} left`,
                  ],
                ]}
              />
            )}
          </Outcome>
          <Outcome
            title={
              create.data
                ? create.data.meta.status === 201
                  ? '201 Created — a new payout'
                  : '200 OK — the existing payout of this externalId'
                : 'Create payout'
            }
            result={create.data}
            error={create.error}
          >
            {(p) => (
              <p className="text-sm">
                Payout{' '}
                <Link to={`/payouts/${p.id}`} className="font-mono text-xs underline underline-offset-4">
                  {p.externalId}
                </Link>
                : {p.status}, {p.amount} {p.asset} plus fee {p.fee}.
              </p>
            )}
          </Outcome>
          {!quote.data && !quote.error && !created && !create.error && (
            <p className="text-sm text-muted-foreground">The quote and the payout appear here.</p>
          )}
        </div>
      </div>
    </>
  );
}
