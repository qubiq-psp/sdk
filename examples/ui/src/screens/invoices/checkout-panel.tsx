import { useCallback, useRef, useState } from 'react';
import { ExternalLink, Link2, Trash2, X } from 'lucide-react';
import type { components } from '@psp-examples/contract/types';
import { CheckoutFrame, widgetInfo } from 'virtual:checkout-frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, call } from '@/api/client';
import { useConfig } from '@/api/config';
import { ErrorView } from '@/components/app/api-error';
import { NetBadge, ToneBadge, type Tone } from '@/components/app/badges';
import { CopyValue } from '@/components/app/code-block';
import { Countdown } from '@/components/app/countdown';
import { Field } from '@/components/app/field';
import { KeyValue, Section } from '@/components/app/page';
import { clock, formatTime } from '@/lib/format';
import type { WidgetEvent } from '@/widget/types';

type Invoice = components['schemas']['V1Invoice'];
type LinkInput = components['schemas']['CheckoutLinkInput'];
type Branding = components['schemas']['CheckoutBranding'];
type CheckoutLink = components['schemas']['CheckoutLink'];

/** The form as typed: an empty field is not sent. */
interface Form {
  companyName: string;
  logoUrl: string;
  accentColor: string;
  theme: '' | NonNullable<Branding['theme']>;
  title: string;
  locale: '' | NonNullable<LinkInput['locale']>;
  expiresInSeconds: string;
}

const TTL_PRESETS: [number, string][] = [
  [60, '1 min'],
  [3600, '1 h'],
  [86_400, '24 h'],
  [604_800, '7 days'],
];
const EVENT_TONES: Record<string, Tone> = {
  ready: 'info',
  status: 'info',
  paid: 'success',
  expired: 'warning',
  resize: 'muted',
  error: 'danger',
  rejected: 'warning',
};

interface LogEntry extends WidgetEvent {
  id: number;
  at: string;
}

/**
 * The body of `POST …/checkout-link`: empty fields are not sent, branding without fields is left out. Values are not
 * corrected: the backend checks them as the SDK does and the error is shown under the field.
 */
export function linkInput(form: Form): LinkInput {
  const branding: Branding = {};
  for (const key of ['companyName', 'logoUrl', 'accentColor', 'title'] as const)
    if (form[key] !== '') branding[key] = form[key];
  if (form.theme) branding.theme = form.theme;
  const ttl = form.expiresInSeconds.trim();
  return {
    ...(Object.keys(branding).length ? { branding } : {}),
    ...(form.locale ? { locale: form.locale } : {}),
    // Empty — not sent: the backend applies the default, 24 h
    ...(ttl ? { expiresInSeconds: Number(ttl) } : {}),
  };
}

/**
 * `400 example_invalid_request` names the field in `details.field`: its dotted path from the root of the body
 * (`branding.logoUrl`, `locale`, …), as the contract pins it.
 */
function fieldOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.errorCode !== 'example_invalid_request') return null;
  const field = (error.details as { field?: unknown } | null)?.field;
  return typeof field === 'string' ? field : null;
}

/**
 * The payment widget of an invoice (gateway docs 20): the backend signs a link offline, the panel shows the payment
 * page in a frame — as a shop's order page would — and the log of what the page reports.
 */
export function CheckoutPanel({
  invoice,
  onClose,
  className,
}: {
  invoice: Invoice;
  onClose: () => void;
  className?: string;
}) {
  const config = useConfig().data?.data;
  const [form, setForm] = useState<Form>(() => ({
    companyName: 'Example shop',
    logoUrl: '',
    accentColor: '',
    theme: '',
    title: `Order ${invoice.externalId}`.slice(0, 100),
    locale: '',
    expiresInSeconds: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<CheckoutLink | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const seq = useRef(0);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onEvent = useCallback((event: WidgetEvent) => {
    seq.current += 1;
    const entry: LogEntry = { ...event, id: seq.current, at: new Date().toISOString() };
    setLog((list) => [entry, ...list].slice(0, 200));
  }, []);

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call('createCheckoutLink', { path: { invoiceId: invoice.id }, body: linkInput(form) });
      setLink(res.data);
      setLog([]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const badField = fieldOf(error);
  const fieldError = (key: string) => (badField === key && error instanceof ApiError ? error.errorMessage : null);
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(form.accentColor);

  return (
    <Section
      title="Payment widget"
      description="POST /api/invoices/{invoiceId}/checkout-link — the backend signs the link with the API secret, without a platform call"
      className={className}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X />
          Hide
        </Button>
      }
    >
      {config && config.net !== 'testnet' && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          <NetBadge net={config.net} /> The payment page shows a mainnet address: a payment there is real money.
        </p>
      )}
      <p className="mb-4 text-sm text-muted-foreground">{widgetInfo.description}</p>
      <form
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void build();
        }}
      >
        <Field
          label="Company name"
          hint="In the page header, 1–64 characters"
          error={fieldError('branding.companyName')}
        >
          {(p) => <Input {...p} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />}
        </Field>
        <Field
          label="Logo URL"
          hint="https:, up to 1024 characters; the buyer's browser loads it"
          error={fieldError('branding.logoUrl')}
        >
          {(p) => (
            <Input
              {...p}
              value={form.logoUrl}
              placeholder="https://shop.example/logo.png"
              className="font-mono text-xs"
              onChange={(e) => set('logoUrl', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Accent colour"
          hint="Buttons, links and the header bar, #rrggbb"
          error={fieldError('branding.accentColor')}
        >
          {(p) => (
            <div className="flex items-center gap-2">
              <Input
                {...p}
                value={form.accentColor}
                placeholder="#4f46e5"
                className="font-mono"
                onChange={(e) => set('accentColor', e.target.value.trim())}
              />
              <span
                aria-hidden
                className="size-9 shrink-0 rounded-md border"
                style={colorValid ? { backgroundColor: form.accentColor } : undefined}
              />
            </div>
          )}
        </Field>
        <Field label="Theme" error={fieldError('branding.theme')}>
          {(p) => (
            <Select
              value={form.theme || 'none'}
              onValueChange={(v) => set('theme', v === 'none' ? '' : (v as Form['theme']))}
            >
              <SelectTrigger id={p.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set — the buyer's system theme</SelectItem>
                <SelectItem value="auto">auto — the system theme</SelectItem>
                <SelectItem value="light">light</SelectItem>
                <SelectItem value="dark">dark</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Order title" hint="Under the header, 1–100 characters" error={fieldError('branding.title')}>
          {(p) => <Input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="Language" error={fieldError('locale')}>
          {(p) => (
            <Select
              value={form.locale || 'none'}
              onValueChange={(v) => set('locale', v === 'none' ? '' : (v as Form['locale']))}
            >
              <SelectTrigger id={p.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set — the buyer's browser language</SelectItem>
                <SelectItem value="en">en</SelectItem>
                <SelectItem value="ru">ru</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Link lifetime, seconds" hint="1 s … 7 days; empty — 24 h" error={fieldError('expiresInSeconds')}>
          {(p) => (
            <div className="flex flex-col gap-1">
              <Input
                {...p}
                inputMode="numeric"
                placeholder="86400"
                value={form.expiresInSeconds}
                className="font-mono"
                onChange={(e) => set('expiresInSeconds', e.target.value)}
              />
              <div className="flex flex-wrap gap-1">
                {TTL_PRESETS.map(([seconds, label]) => (
                  <Button
                    key={seconds}
                    variant={form.expiresInSeconds === String(seconds) ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    aria-label={`Lifetime ${label}`}
                    onClick={() => set('expiresInSeconds', String(seconds))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Field>
        <div className="flex items-end sm:col-span-2 xl:col-span-2">
          <Button type="submit" disabled={busy}>
            <Link2 />
            Create link
          </Button>
        </div>
      </form>
      {error !== null && !badField && (
        <div className="mt-4">
          <ErrorView error={error} title="Widget link" />
        </div>
      )}
      {error !== null && badField && (
        <p className="mt-4 text-sm text-destructive">
          {error instanceof ApiError ? `${error.errorCode}: ${badField} — ${error.errorMessage}` : null}
        </p>
      )}

      {link && config && (
        <div className="mt-6 flex flex-col gap-4 border-t pt-4">
          <KeyValue
            items={[
              ['Link', <CopyValue key="u" value={link.url} />],
              [
                'Valid until',
                <span key="e">
                  {formatTime(link.expiresAt)} · <Countdown until={link.expiresAt} />
                </span>,
              ],
              [
                'Page',
                <a
                  key="o"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  Open in a new tab <ExternalLink className="size-3.5" aria-hidden />
                </a>,
              ],
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
            <div className="self-start overflow-hidden rounded-md border bg-background">
              <CheckoutFrame
                key={link.token}
                url={link.url}
                checkoutOrigin={config.checkoutUrl}
                onEvent={onEvent}
                title="Payment page"
              />
            </div>
            <EventLog log={log} onClear={() => setLog([])} />
          </div>
        </div>
      )}
    </Section>
  );
}

function EventLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Widget events ({log.length})</h3>
        <Button variant="ghost" size="sm" disabled={log.length === 0} onClick={onClear}>
          <Trash2 />
          Clear
        </Button>
      </div>
      {log.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Waiting for ready, status, resize and error from the payment page.
        </p>
      ) : (
        <Table aria-live="polite">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Fields</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">{clock(m.at)}</TableCell>
                <TableCell>
                  <ToneBadge tone={EVENT_TONES[m.type] ?? 'neutral'}>{m.type}</ToneBadge>
                </TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">
                  {JSON.stringify(m.fields)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Browser events can be faked: a shop shows "thank you" on them, but ships the order on the invoice.paid or
        invoice.overpaid webhook its server receives.
      </p>
    </div>
  );
}
