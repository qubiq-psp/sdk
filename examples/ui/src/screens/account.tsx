import { RefreshCw } from 'lucide-react';
import { widgetInfo } from 'virtual:checkout-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiKey, useApi, useRefresh } from '@/api/hooks';
import { useConfig } from '@/api/config';
import { NetBadge, ToneBadge } from '@/components/app/badges';
import { CallLine } from '@/components/app/call-info';
import { CopyValue } from '@/components/app/code-block';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { formatTime } from '@/lib/format';

const yesNo = (v: boolean) =>
  v ? <ToneBadge tone="success">yes</ToneBadge> : <ToneBadge tone="neutral">no</ToneBadge>;

/** How far the browser clock is from the platform's: signatures allow a few minutes (the request-signing rules). */
function skew(serverSeconds: number): string {
  const seconds = Math.round(Date.now() / 1000 - serverSeconds);
  if (Math.abs(seconds) < 2) return 'in sync';
  return `${Math.abs(seconds)} s ${seconds > 0 ? 'ahead' : 'behind'}`;
}

export function AccountScreen() {
  const config = useConfig();
  const account = useApi('getAccount');
  const refresh = useRefresh();

  return (
    <>
      <PageHeader
        title="Account"
        description="The merchant this deployment works for, and the backend in between. One merchant per deployment: the API key and secret live in the backend's environment, the browser never sees the secret."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh(apiKey('getAccount'))}>
            <RefreshCw className={account.isFetching ? 'animate-spin' : undefined} />
            Check again
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Merchant" description="GET /api/account → Merchant API getAccount">
          <QueryView query={account} title="Account">
            {(a, res) => (
              <div className="flex flex-col gap-4">
                {(a.apiKey.status === 'previous' || res.meta.apiKeyDeprecated) && (
                  <Alert>
                    <AlertTitle>The backend signs with the previous API key</AlertTitle>
                    <AlertDescription>
                      It works until {formatTime(res.meta.apiKeyDeprecated ?? a.apiKey.graceUntil)} (header
                      X-Api-Key-Deprecated). Put the new key into the backend's environment before then.
                    </AlertDescription>
                  </Alert>
                )}
                <KeyValue
                  items={[
                    ['Name', a.name],
                    ['Merchant id', <CopyValue key="m" value={a.merchantId} />],
                    [
                      'Status',
                      <ToneBadge key="s" tone={a.status === 'active' ? 'success' : 'danger'}>
                        {a.status}
                      </ToneBadge>,
                    ],
                    ['Can create invoices', yesNo(a.invoicesEnabled)],
                    ['Can create payouts', yesNo(a.payoutsEnabled)],
                    ['API key', <CopyValue key="k" value={a.apiKey.keyId} />],
                    [
                      'Key status',
                      <ToneBadge key="ks" tone={a.apiKey.status === 'current' ? 'success' : 'warning'}>
                        {a.apiKey.status}
                      </ToneBadge>,
                    ],
                    ['Previous key works until', formatTime(a.apiKey.graceUntil)],
                    [
                      'Platform time',
                      `${formatTime(new Date(a.serverTime * 1000).toISOString())} (this browser is ${skew(a.serverTime)})`,
                    ],
                  ]}
                />
                <CallLine meta={res.meta} />
              </div>
            )}
          </QueryView>
        </Section>

        <Section
          title="This deployment"
          description="GET /api/config — answered by the backend itself, no platform call"
        >
          <QueryView query={config} title="Config">
            {(c) => (
              <KeyValue
                items={[
                  [
                    'Backend',
                    c.backend === 'sdk'
                      ? `sdk — NestJS on @qubiq-psp/sdk ${c.sdkVersion ?? ''}`
                      : 'plain — signs requests and checks webhooks by hand',
                  ],
                  ['Backend version', c.version],
                  ['Net', <NetBadge key="n" net={c.net} />],
                  ['Merchant API', <CopyValue key="u" value={c.apiUrl} />],
                  ['API key', <CopyValue key="k" value={c.keyId} />],
                  ['Previous secret set', c.previousSecretSet ? 'yes — webhooks signed with it are accepted' : 'no'],
                  ['Payment page', <CopyValue key="c" value={c.checkoutUrl} />],
                  [
                    'Webhook receiver',
                    c.webhookUrl ? <CopyValue key="w" value={c.webhookUrl} /> : 'not set (PUBLIC_URL is empty)',
                  ],
                  ['Backend time', formatTime(c.serverTime)],
                  ['Payment widget in this UI', widgetInfo.label],
                ]}
              />
            )}
          </QueryView>
        </Section>
      </div>
      <Section title="What to test here" className="mt-6">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Every screen calls the backend, and the backend calls the Merchant API. Each result links to its entries in
            the <strong>Request log</strong>: method, path, status, X-Request-Id, headers and bodies
            {config.data?.data.backend === 'plain' ? ', and the string the backend signed' : ', and the SDK method'}.
          </li>
          <li>Platform errors are shown as they came: errorCode, message and details.</li>
          <li>
            Webhooks: set the URL on <strong>Webhook settings</strong>, then watch <strong>Received webhooks</strong>.
          </li>
          <li>{widgetInfo.description}</li>
        </ul>
      </Section>
    </>
  );
}
