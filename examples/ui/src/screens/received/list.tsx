import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import type { components } from '@psp-examples/contract/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { call } from '@/api/client';
import { useConfig } from '@/api/config';
import { apiKey, invalidateOps, useApi, useRefresh } from '@/api/hooks';
import { ConfirmButton } from '@/components/app/confirm-button';
import { CopyValue } from '@/components/app/code-block';
import { Field } from '@/components/app/field';
import { EnumFilter, FilterBar, TextFilter } from '@/components/app/filters';
import { Outcome } from '@/components/app/outcome';
import { Empty, PageHeader, Section } from '@/components/app/page';
import { Pager } from '@/components/app/pager';
import { QueryView } from '@/components/app/query-view';
import { WEBHOOK_EVENTS } from '@/lib/enums';
import { useSearchState } from '@/lib/search-state';
import { ReceivedTable } from './table';

type ReceiverSettings = components['schemas']['ReceiverSettings'];

const LIMIT = 25;

export function ReceivedScreen() {
  const qc = useQueryClient();
  const refresh = useRefresh();
  const config = useConfig().data?.data;
  const { values, set, page, setPage } = useSearchState(['invoiceId', 'webhookId', 'event', 'result'] as const);
  const query = {
    page,
    limit: LIMIT,
    ...(values.invoiceId ? { invoiceId: values.invoiceId } : {}),
    ...(values.webhookId ? { webhookId: values.webhookId } : {}),
    ...(values.event ? { event: values.event } : {}),
    ...(values.result ? { result: values.result as 'ok' | 'failed' } : {}),
  };
  // New webhooks arrive over the live stream (SSE `webhook`): no polling needed
  const list = useApi('listReceivedWebhooks', { query });
  const clear = useMutation({
    mutationFn: () => call('clearReceivedWebhooks'),
    onSettled: () => invalidateOps(qc, 'listReceivedWebhooks'),
  });

  return (
    <>
      <PageHeader
        title="Received webhooks"
        description={
          <>
            Everything that reached this backend's receiver POST /webhooks/psp, verified by the webhook signature rules,
            newest first. Updates live.
            {config?.webhookUrl && (
              <span className="mt-1 flex flex-wrap items-center gap-1">
                Receiver URL: <CopyValue value={config.webhookUrl} />
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('listReceivedWebhooks', { query }))}>
              <RefreshCw className={list.isFetching ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <ConfirmButton
              title="Clear the received-webhooks log?"
              description="DELETE /api/received-webhooks. The receiver also forgets which webhook ids it accepted, so the next copy is not a duplicate."
              confirmLabel="Clear"
              destructive
              onConfirm={() => clear.mutate()}
            >
              <Trash2 />
              Clear log
            </ConfirmButton>
          </>
        }
      />
      {clear.error !== null && (
        <div className="mb-4">
          <Outcome title="Clear log" result={undefined} error={clear.error} />
        </div>
      )}
      <ReceiverSettingsSection />
      <Section className="mt-6">
        <FilterBar onReset={() => set({ invoiceId: '', webhookId: '', event: '', result: '' })}>
          <EnumFilter
            label="Verification"
            value={values.result}
            options={['ok', 'failed']}
            onChange={(v) => set({ result: v })}
          />
          <EnumFilter label="Event" value={values.event} options={WEBHOOK_EVENTS} onChange={(v) => set({ event: v })} />
          <TextFilter label="Invoice id" value={values.invoiceId} onChange={(v) => set({ invoiceId: v })} />
          <TextFilter label="Webhook id" value={values.webhookId} onChange={(v) => set({ webhookId: v })} />
        </FilterBar>
        <QueryView query={list} title="Received webhooks">
          {(r) => (
            <>
              {r.items.length ? (
                <ReceivedTable items={r.items} />
              ) : (
                <Empty title="Nothing received yet">
                  Set the webhook URL to this backend and send a test webhook on Webhook settings.
                </Empty>
              )}
              <Pager page={r.page} limit={r.limit} total={r.total} onPage={setPage} />
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}

/** How the receiver answers: to produce retries, failed deliveries and redeliveries on purpose. */
function ReceiverSettingsSection() {
  const qc = useQueryClient();
  const settings = useApi('getReceiverSettings');
  const [form, setForm] = useState<{
    mode: ReceiverSettings['mode'];
    status: string;
    delayMs: string;
    failNext: string;
  } | null>(null);
  const save = useMutation({
    mutationFn: (body: ReceiverSettings) => call('setReceiverSettings', { body }),
    onSuccess: (res) =>
      qc.setQueryData(apiKey('getReceiverSettings'), (old: unknown) => (old ? { ...old, data: res.data } : old)),
  });
  const current = settings.data?.data;
  // The form starts from the stored settings once they arrive
  if (current && form === null) {
    setForm({
      mode: current.mode,
      status: String(current.status),
      delayMs: String(current.delayMs),
      failNext: String(current.failNext),
    });
  }

  return (
    <Section
      title="How the receiver answers"
      description="GET /api/receiver · PUT /api/receiver — kept in memory by the backend, reset on restart"
    >
      <QueryView query={settings} title="Receiver settings">
        {(s) => (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Now:{' '}
              {s.mode === 'auto'
                ? 'as a merchant would (200 on a valid webhook, 401/400 otherwise)'
                : `always ${s.status}`}
              {s.failNext > 0 ? `; the next ${s.failNext} webhook(s) get ${s.status}` : ''}
              {s.delayMs > 0 ? `; answers after ${s.delayMs} ms` : ''}.
            </p>
            {form && (
              <form
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({
                    mode: form.mode,
                    status: Number(form.status),
                    delayMs: Number(form.delayMs),
                    failNext: Number(form.failNext),
                  });
                }}
              >
                <Field label="Mode">
                  {(p) => (
                    <Select
                      value={form.mode}
                      onValueChange={(v) => setForm({ ...form, mode: v as ReceiverSettings['mode'] })}
                    >
                      <SelectTrigger id={p.id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">auto — as a merchant</SelectItem>
                        <SelectItem value="fixed">fixed — always the status</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="Status" hint="200–599: for fixed mode and fail next">
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Fail next" hint="How many next webhooks get the status (0–100)">
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={form.failNext}
                      onChange={(e) => setForm({ ...form, failNext: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Delay, ms" hint="0–30000; the platform gives up after 10 s">
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      value={form.delayMs}
                      onChange={(e) => setForm({ ...form, delayMs: e.target.value })}
                    />
                  )}
                </Field>
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm" disabled={save.isPending}>
                    <Save />
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ mode: 'auto', status: '500', delayMs: '0', failNext: '0' })}
                  >
                    Defaults
                  </Button>
                </div>
              </form>
            )}
            <div className="mt-3">
              <Outcome title="Receiver settings" result={save.data} error={save.error} />
            </div>
          </>
        )}
      </QueryView>
    </Section>
  );
}
