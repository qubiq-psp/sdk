import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Dices, Repeat, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { components } from '@psp-examples/contract/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { call, errorText, type ApiResponse } from '@/api/client';
import { invalidateOps } from '@/api/hooks';
import { useReference } from '@/api/reference';
import { INVOICE_TONES, StatusBadge } from '@/components/app/badges';
import { ErrorView } from '@/components/app/api-error';
import { Field } from '@/components/app/field';
import { Outcome } from '@/components/app/outcome';
import { Loading, PageHeader, Section } from '@/components/app/page';
import { PairSelect } from '@/components/app/pair-select';
import { amountProblem, bumpAmount, limitWarning, newExternalId } from '@/lib/decimal';
import { networkLabel, tariffRule } from '@/lib/networks';

type Invoice = components['schemas']['V1Invoice'];
type CreateBody = components['schemas']['createInvoiceBody'];

/** Fields a detail screen can pass: "Create one like this". */
export interface InvoicePrefill {
  network?: string;
  asset?: string;
  amount?: string;
  description?: string;
  metadata?: string;
}

interface Attempt {
  id: number;
  label: string;
  expect: string;
  result?: ApiResponse<Invoice>;
  error?: unknown;
}

/** What the status of a create means: `201` — a new invoice, `200` — the one with this `externalId` already. */
const createdText = (status: number) =>
  status === 201
    ? '201 Created — a new invoice'
    : status === 200
      ? '200 OK — the existing invoice of this externalId'
      : String(status);

export function InvoiceNewScreen() {
  const qc = useQueryClient();
  const prefill = (useLocation().state as InvoicePrefill | null) ?? {};
  const { networks, tariff, pairs, rules } = useReference();
  const invoicePairs = pairs.filter((p) => p.invoicesEnabled);

  const [pair, setPair] = useState(prefill.network && prefill.asset ? `${prefill.network}/${prefill.asset}` : '');
  const [externalId, setExternalId] = useState(() => newExternalId('inv'));
  const [amount, setAmount] = useState(prefill.amount ?? '1');
  const [description, setDescription] = useState(prefill.description ?? 'Test order');
  const [metadata, setMetadata] = useState(prefill.metadata ?? '{"source":"examples-ui"}');
  const [clientRequestId, setClientRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  // Default: the first pair the platform offers — nothing is hard-coded, the platform decides what is enabled
  const selected = invoicePairs.find((a) => a.key === pair) ?? invoicePairs[0];
  const rule = selected && rules ? tariffRule(rules, 'deposit', selected) : null;
  const amountError = amount ? amountProblem(amount, selected) : 'Enter an amount';
  const amountWarning = limitWarning(amount, rule?.invoiceMin, rule?.invoiceMax);
  let metadataError: string | null = null;
  if (metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) metadataError = 'A JSON object';
    } catch {
      metadataError = 'Not valid JSON';
    }
  }
  const valid = !amountError && !metadataError && externalId.trim() !== '' && selected !== undefined;

  /** The body in the order of the platform's example; empty optional fields are not sent. */
  const body = (overrides: { amount?: string } = {}): CreateBody => ({
    externalId: externalId.trim(),
    network: selected?.network ?? '',
    asset: selected?.asset ?? '',
    amount: overrides.amount ?? amount,
    ...(description ? { description } : {}),
    ...(metadata.trim() ? { metadata: JSON.parse(metadata) as Record<string, unknown> } : {}),
  });

  const send = async (label: string, expect: string, payload: CreateBody) => {
    setBusy(true);
    const id = Date.now();
    try {
      const result = await call('createInvoice', {
        body: payload,
        ...(clientRequestId ? { clientRequestId } : {}),
      });
      setAttempts((list) => [{ id, label, expect, result }, ...list]);
      toast.success(createdText(result.meta.status));
    } catch (error) {
      setAttempts((list) => [{ id, label, expect, error }, ...list]);
      toast.error(errorText(error));
    } finally {
      setBusy(false);
      invalidateOps(qc, 'listInvoices');
    }
  };

  const created = attempts.find((a) => a.result)?.result?.data;

  return (
    <>
      <PageHeader
        title="New invoice"
        description="POST /api/invoices. The payment address comes back at once. The same externalId with the same fields returns the same invoice (200); with other fields — 409 invoice_conflict."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/invoices">All invoices</Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
        <Section title="Invoice">
          {networks.isPending && <Loading text="Loading networks…" />}
          {networks.error && <ErrorView error={networks.error} title="Networks" />}
          {tariff.error && <ErrorView error={tariff.error} title="Tariff" />}
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void send('Create', '201 Created', body());
            }}
          >
            <Field
              label="Network and asset"
              hint={
                selected &&
                [
                  limitsText(rule, tariff.isPending, Boolean(rules)),
                  `${selected.decimals} decimals`,
                  `less than ${selected.minCreditAmount} is dust`,
                  selected.contract ? `contract ${selected.contract}` : null,
                  selected.family === 'evm'
                    ? `the buyer must pay in ${networkLabel(selected.network)}: the 0x… address is the same in every EVM network, payments in another network are not credited`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
            >
              {(p) => (
                <PairSelect
                  id={p.id}
                  describedBy={p['aria-describedby']}
                  pairs={invoicePairs}
                  value={selected?.key ?? ''}
                  onChange={setPair}
                />
              )}
            </Field>
            <Field
              label="Amount"
              error={amount ? amountError : null}
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
            <Field label="External id" hint="Your order id, up to 128 characters. Repeat it to test idempotency.">
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
                    onClick={() => setExternalId(newExternalId('inv'))}
                  >
                    <Dices />
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Description" hint="Up to 255 characters; not shown to the buyer">
              {(p) => (
                <Input {...p} value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} />
              )}
            </Field>
            <Field label="Metadata (a JSON object, optional)" error={metadataError}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={metadata}
                  className="font-mono text-xs"
                  onChange={(e) => setMetadata(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="X-Client-Request-Id (optional)"
              hint="Your own request id: the platform echoes it and the request log shows it"
            >
              {(p) => (
                <Input
                  {...p}
                  value={clientRequestId}
                  placeholder="shop-req-1"
                  className="font-mono"
                  onChange={(e) => setClientRequestId(e.target.value.trim())}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !valid}>
                <Send />
                Create
              </Button>
              <Button
                variant="outline"
                disabled={busy || !valid || attempts.length === 0}
                title="The same externalId and fields: expect 200 and the same invoice"
                onClick={() => void send('Repeat with the same body', '200 and the same invoice', body())}
              >
                <Repeat />
                Repeat
              </Button>
              <Button
                variant="outline"
                disabled={busy || !valid || attempts.length === 0}
                title="The same externalId, another amount: expect 409 invoice_conflict"
                onClick={() =>
                  void send(
                    'Same external id, another amount',
                    '409 invoice_conflict',
                    body({ amount: bumpAmount(amount) }),
                  )
                }
              >
                <Copy />
                Conflict
              </Button>
            </div>
          </form>
        </Section>

        <div className="flex min-w-0 flex-col gap-4">
          {created && (
            <Section
              title="Invoice"
              actions={
                <Button asChild size="sm">
                  <Link to={`/invoices/${created.id}`}>Open the invoice</Link>
                </Button>
              }
            >
              <p className="text-sm">
                {created.amount} {created.asset} to{' '}
                <span className="font-mono text-xs break-all">{created.address}</span>, status{' '}
                <StatusBadge value={created.status} tones={INVOICE_TONES} />
              </p>
            </Section>
          )}
          {attempts.length === 0 && (
            <p className="text-sm text-muted-foreground">Each attempt and the platform's answer appear here.</p>
          )}
          {attempts.map((a, i) => (
            <Outcome
              key={a.id}
              title={`${attempts.length - i}. ${a.label} — expected ${a.expect}${a.result ? `, got ${createdText(a.result.meta.status)}` : ''}`}
              result={a.result}
              error={a.error}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/** Invoice amount limits from the tariff's `deposit` rule for the pair (gateway docs 13.9). */
function limitsText(rule: ReturnType<typeof tariffRule>, pending: boolean, loaded: boolean): string {
  if (pending) return 'Amount limits: loading the tariff…';
  if (!loaded) return 'Amount limits unknown: the tariff did not load';
  if (!rule) return 'No deposit rule for this pair: expect 409 tariff_not_configured';
  return `Amount ${rule.invoiceMin ?? 'no minimum'} … ${rule.invoiceMax ?? 'no maximum'} (tariff deposit rule)`;
}
