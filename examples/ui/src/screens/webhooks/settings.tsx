import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2Off, RefreshCw, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/api/client';
import { useConfig } from '@/api/config';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { ConfirmButton } from '@/components/app/confirm-button';
import { Field } from '@/components/app/field';
import { AutoRefresh, DateFilter, EnumFilter, FilterBar, MultiFilter, TextFilter } from '@/components/app/filters';
import { Outcome } from '@/components/app/outcome';
import { Empty, KeyValue, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { QueryView } from '@/components/app/query-view';
import { DELIVERY_KINDS, DELIVERY_STATUSES, WEBHOOK_EVENTS } from '@/lib/enums';
import { formatTime } from '@/lib/format';
import { listOf, useSearchState } from '@/lib/search-state';
import { DeliveryTable } from './delivery-table';

/** A `202` means the platform accepted the change and applies it in the background (`sync.state: pending`). */
const acceptedText = (status: number) => (status === 202 ? '202 Accepted — applied in the background' : `${status}`);

export function WebhookSettingsScreen() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const config = useConfig().data?.data;
  const settings = useApi('getWebhookSettings');
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('Hello from the example UI');
  const shownUrl = url ?? config?.webhookUrl ?? '';

  const after = () => invalidateOps(qc, 'getWebhookSettings', 'listDeliveries');
  const setUrlM = useMutation({
    mutationFn: (value: string) => call('setWebhookUrl', { body: { url: value } }),
    onSettled: after,
  });
  const removeM = useMutation({ mutationFn: () => call('removeWebhookUrl'), onSettled: after });
  const testM = useMutation({
    mutationFn: () => call('sendTestWebhook', { body: message ? { message } : {} }),
    onSettled: after,
  });

  return (
    <>
      <PageHeader
        title="Webhook settings"
        description="Where the platform sends webhooks for this merchant, a test webhook, and what the platform delivered."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('getWebhookSettings'))}>
            <RefreshCw className={settings.isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Current settings" description="GET /api/webhook">
          <QueryView query={settings} title="Webhook settings">
            {(s, res) => (
              <div className="flex flex-col gap-3">
                <KeyValue
                  items={[
                    [
                      'URL',
                      s.webhookUrl ? <span className="font-mono text-xs break-all">{s.webhookUrl}</span> : 'not set',
                    ],
                    [
                      'Points to this backend',
                      config?.webhookUrl && s.webhookUrl === config.webhookUrl ? (
                        <ToneBadge tone="success">yes</ToneBadge>
                      ) : (
                        <ToneBadge tone="warning">no</ToneBadge>
                      ),
                    ],
                    ['Delivery state', s.deliveryState ?? '—'],
                    ['URL set', formatTime(s.webhookUrlSetAt)],
                    [
                      'Secret set',
                      s.secretSet === null ? '—' : s.secretSet ? `yes, ${formatTime(s.secretSetAt)}` : 'no',
                    ],
                    ['Paused after a secret change until', formatTime(s.secretHoldUntil)],
                    ['Paused', s.paused === null ? '—' : s.paused ? 'yes' : 'no'],
                    ['Failures in a row', s.consecutiveFailures ?? '—'],
                    ['Failing since', formatTime(s.failingSince)],
                    ['Last attempt', formatTime(s.lastAttemptAt)],
                    ['Last success', formatTime(s.lastSuccessAt)],
                    ['Queue', s.queue ? `${s.queue.waiting} waiting, ${s.queue.pending} pending` : '—'],
                    [
                      'Sync',
                      `${s.sync.state}${s.sync.desiredUrl ? ` → ${s.sync.desiredUrl}` : ''}${s.sync.rejectedReason ? ` (${s.sync.rejectedReason})` : ''}`,
                    ],
                  ]}
                />
                <CallLine meta={res.meta} />
              </div>
            )}
          </QueryView>
        </Section>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Webhook URL" description="PUT /api/webhook · DELETE /api/webhook">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setUrlM.mutate(shownUrl.trim());
              }}
            >
              <Field
                label="URL"
                hint={
                  config?.webhookUrl
                    ? `This backend's receiver is ${config.webhookUrl}. Any other https URL works too.`
                    : 'This backend has no public URL (PUBLIC_URL): type the URL of a receiver.'
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    value={shownUrl}
                    placeholder="https://shop.example/psp/webhooks"
                    className="font-mono text-xs"
                    onChange={(e) => setUrl(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={!shownUrl.trim() || setUrlM.isPending}>
                  <Save />
                  Set URL
                </Button>
                <ConfirmButton
                  title="Remove the webhook URL?"
                  description="The platform stops sending webhooks; new ones wait until a URL is set again."
                  confirmLabel="Remove"
                  destructive
                  disabled={removeM.isPending}
                  onConfirm={() => removeM.mutate()}
                >
                  <Link2Off />
                  Remove URL
                </ConfirmButton>
              </div>
            </form>
            <div className="mt-3 flex flex-col gap-3">
              <Outcome
                title={setUrlM.data ? `Set URL: ${acceptedText(setUrlM.data.meta.status)}` : 'Set URL'}
                result={setUrlM.data}
                error={setUrlM.error}
              />
              <Outcome
                title={removeM.data ? `Remove URL: ${acceptedText(removeM.data.meta.status)}` : 'Remove URL'}
                result={removeM.data}
                error={removeM.error}
              />
            </div>
          </Section>

          <Section
            title="Test webhook"
            description="POST /api/webhook/test — the platform sends webhook.test to the URL"
          >
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                testM.mutate();
              }}
            >
              <Field label="Message (optional)" className="flex-1">
                {(p) => <Input {...p} value={message} onChange={(e) => setMessage(e.target.value)} />}
              </Field>
              <Button type="submit" size="sm" disabled={testM.isPending}>
                <Send />
                Send test
              </Button>
            </form>
            <div className="mt-3">
              <Outcome title="Test webhook" result={testM.data} error={testM.error}>
                {(d) => (
                  <p className="text-sm">
                    Delivery{' '}
                    <Link
                      to={`/webhooks/deliveries/${d.id}`}
                      className="font-mono text-xs underline underline-offset-4"
                    >
                      {d.id}
                    </Link>
                    : {d.status}, {d.attempts} attempt(s){d.lastHttpStatus ? `, last answer ${d.lastHttpStatus}` : ''}.
                  </p>
                )}
              </Outcome>
            </div>
          </Section>
        </div>
      </div>
      <Deliveries />
    </>
  );
}

const LIMIT = 20;

function Deliveries() {
  const { values, set, page, setPage } = useSearchState(['status', 'kind', 'type', 'invoiceId', 'from', 'to'] as const);
  const [auto, setAuto] = useState(false);
  const query = {
    page,
    limit: LIMIT,
    ...(values.status ? { status: listOf(values.status) as (typeof DELIVERY_STATUSES)[number][] } : {}),
    ...(values.kind ? { kind: values.kind as (typeof DELIVERY_KINDS)[number] } : {}),
    ...(values.type ? { type: listOf(values.type) as (typeof WEBHOOK_EVENTS)[number][] } : {}),
    ...(values.invoiceId ? { invoiceId: values.invoiceId } : {}),
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
  };
  const list = useApi('listDeliveries', { query }, { pollMs: auto ? 5000 : false });
  const refresh = useRefresh();
  return (
    <Section
      title="Platform deliveries"
      description="GET /api/webhook/deliveries — every webhook the platform sent or will send, with its attempts"
      className="mt-6"
      actions={
        <>
          <AutoRefresh checked={auto} onChange={setAuto} seconds={5} />
          <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listDeliveries', { query }))}>
            <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        </>
      }
    >
      <FilterBar onReset={() => set({ status: '', kind: '', type: '', invoiceId: '', from: '', to: '' })}>
        <EnumFilter label="Kind" value={values.kind} options={DELIVERY_KINDS} onChange={(v) => set({ kind: v })} />
        <TextFilter label="Invoice id" value={values.invoiceId} onChange={(v) => set({ invoiceId: v })} />
        <DateFilter label="Created from" value={values.from} onChange={(v) => set({ from: v })} />
        <DateFilter label="Created before" value={values.to} onChange={(v) => set({ to: v })} />
        <MultiFilter
          label="Status"
          options={DELIVERY_STATUSES}
          values={listOf(values.status)}
          onChange={(v) => set({ status: v.join(',') })}
        />
        <MultiFilter
          label="Event"
          options={WEBHOOK_EVENTS}
          values={listOf(values.type)}
          onChange={(v) => set({ type: v.join(',') })}
        />
      </FilterBar>
      <QueryView query={list} title="Deliveries">
        {(d, res) => (
          <>
            {d.items.length ? <DeliveryTable items={d.items} /> : <Empty title="No deliveries" />}
            <Pager page={d.page} limit={d.limit} total={d.total} onPage={setPage} />
            <div className="mt-3">
              <CallLine meta={res.meta} />
            </div>
          </>
        )}
      </QueryView>
    </Section>
  );
}
