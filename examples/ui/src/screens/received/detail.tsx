import { Link, useParams } from 'react-router';
import { httpTone, INVOICE_TONES, StatusBadge, ToneBadge } from '@/components/app/badges';
import { CodeBlock, CopyValue, JsonBlock } from '@/components/app/code-block';
import { useApi } from '@/api/hooks';
import { useConfig } from '@/api/config';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { Button } from '@/components/ui/button';
import { formatTime, headersText, prettyJson } from '@/lib/format';

export function ReceivedDetailScreen() {
  const { receivedId = '' } = useParams();
  const item = useApi('getReceivedWebhook', { path: { receivedId } });
  const backend = useConfig().data?.data.backend;
  return (
    <>
      <PageHeader
        title="Received webhook"
        description="GET /api/received-webhooks/{receivedId}: the request as it arrived, the verification step by step, and our answer"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/received">All received webhooks</Link>
          </Button>
        }
      />
      <QueryView query={item} title="Received webhook">
        {(w) => (
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Verification">
                <KeyValue
                  items={[
                    [
                      'Result',
                      <ToneBadge key="r" tone={w.verify.result === 'ok' ? 'success' : 'danger'}>
                        {w.verify.result}
                      </ToneBadge>,
                    ],
                    ['Why', w.verify.message],
                    ['Signature matches a secret', w.verify.signatureValid ? 'yes' : 'no'],
                    ['Signed with', w.signedWith ? `the ${w.signedWith} secret` : 'no configured secret'],
                    ['Timestamp', w.verify.timestamp ?? '—'],
                    ['Clock difference', w.verify.skewSeconds === null ? '—' : `${w.verify.skewSeconds} s`],
                    ['Body size', `${w.verify.bodyBytes} bytes`],
                    [
                      'Expected signature',
                      w.verify.expectedSignature ? <CopyValue key="s" value={w.verify.expectedSignature} /> : '—',
                    ],
                    ['Duplicate', w.duplicate ? 'yes — this webhook id was already accepted' : 'no'],
                  ]}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  {backend === 'sdk'
                    ? 'The sdk backend verifies with verifyWebhook() of @qubiq-psp/sdk and computes the expected signature with signWebhook().'
                    : 'The plain backend verifies by hand: HMAC-SHA256 of "{timestamp}.{raw body}" with the API secret, then the body checks.'}
                </p>
              </Section>
              <Section title="Request and our answer">
                <KeyValue
                  items={[
                    ['Received', formatTime(w.receivedAt)],
                    [
                      'Event',
                      <span key="e" className="font-mono text-xs">
                        {w.event ?? '—'}
                      </span>,
                    ],
                    ['Webhook id', w.webhookId ? <CopyValue key="i" value={w.webhookId} /> : '—'],
                    ['Attempt', w.attempt ?? '—'],
                    [
                      'Invoice',
                      w.invoiceId ? (
                        <span key="v" className="flex flex-wrap items-center gap-1">
                          <Link
                            to={`/invoices/${w.invoiceId}`}
                            className="font-mono text-xs underline underline-offset-4"
                          >
                            {w.externalId ?? w.invoiceId}
                          </Link>
                          <StatusBadge value={w.invoiceStatus} tones={INVOICE_TONES} />
                        </span>
                      ) : (
                        '—'
                      ),
                    ],
                    ['From', w.remoteIp ?? '—'],
                    [
                      'Our answer',
                      <ToneBadge key="a" tone={httpTone(w.responseStatus)}>
                        {w.responseStatus}
                      </ToneBadge>,
                    ],
                    ['Answered after', `${w.responseDelayMs} ms`],
                  ]}
                />
                <CodeBlock label="Answer body" value={w.responseBody ?? ''} maxHeight="max-h-24" className="mt-3" />
              </Section>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Headers">
                <CodeBlock value={headersText(w.headers)} maxHeight="max-h-80" />
              </Section>
              <Section title="Body">
                {w.json !== null && w.json !== undefined ? (
                  <JsonBlock value={w.json} maxHeight="max-h-80" />
                ) : (
                  <CodeBlock value={prettyJson(w.body)} maxHeight="max-h-80" />
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Raw body, byte for byte</summary>
                  <CodeBlock value={w.body} maxHeight="max-h-60" />
                </details>
              </Section>
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
