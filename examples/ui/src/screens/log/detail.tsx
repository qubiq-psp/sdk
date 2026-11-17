import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { useApi } from '@/api/hooks';
import { HttpStatus, ToneBadge } from '@/components/app/badges';
import { LogLink } from '@/components/app/call-info';
import { CodeBlock, CopyValue } from '@/components/app/code-block';
import { KeyValue, PageHeader, Section } from '@/components/app/page';
import { QueryView } from '@/components/app/query-view';
import { formatTime, headersText, prettyJson } from '@/lib/format';

export function RequestLogEntryScreen() {
  const { entryId = '' } = useParams();
  const entry = useApi('getRequestLogEntry', { path: { entryId } });
  return (
    <>
      <PageHeader
        title="Request"
        description="GET /api/request-log/{entryId}: one attempt as the backend sent it to the Merchant API, and the answer"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/log">Request log</Link>
          </Button>
        }
      />
      <QueryView query={entry} title="Request-log entry">
        {(e) => (
          <div className="flex flex-col gap-6">
            <Section title="Summary">
              <KeyValue
                items={[
                  ['Request', <span key="r" className="font-mono text-xs break-all">{`${e.method} ${e.url}`}</span>],
                  [
                    'Operation',
                    <span key="o" className="font-mono text-xs">
                      {e.operationId}
                    </span>,
                  ],
                  [
                    'SDK method',
                    e.sdkMethod ? (
                      <span className="font-mono text-xs">psp.{e.sdkMethod}()</span>
                    ) : (
                      '— (plain backend: no SDK)'
                    ),
                  ],
                  ['Answer', <HttpStatus key="s" status={e.status} label={e.transportError?.code} />],
                  ['Error code', e.errorCode ? <span className="font-mono text-xs">{e.errorCode}</span> : '—'],
                  [
                    'No answer because',
                    e.transportError ? `${e.transportError.code}: ${e.transportError.message}` : '—',
                  ],
                  ['Sent', formatTime(e.createdAt)],
                  ['Duration', `${e.durationMs} ms`],
                  ['Attempt', e.attempt],
                  [
                    'Source',
                    e.source === 'poll' ? (
                      <ToneBadge key="p" tone="muted">
                        auto-refresh
                      </ToneBadge>
                    ) : (
                      'your action'
                    ),
                  ],
                  ['X-Request-Id', e.requestId ? <CopyValue key="q" value={e.requestId} /> : '—'],
                  ['X-Client-Request-Id', e.clientRequestId ?? '—'],
                  ['Previous key works until', formatTime(e.apiKeyDeprecatedUntil)],
                  [
                    'Call',
                    <span key="c" className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs break-all">{e.callId}</span>
                      <LogLink callId={e.callId} label="All attempts of this call" />
                    </span>,
                  ],
                ]}
              />
            </Section>
            <Section
              title="Signature"
              description="Merchant API requests are signed with HMAC-SHA256 over six lines (gateway docs 13.2): v1, method, path with query, timestamp, nonce, sha256 of the body"
            >
              {e.signing ? (
                <div className="flex flex-col gap-3">
                  <CodeBlock label="String to sign" value={e.signing.stringToSign} maxHeight="max-h-40" />
                  <CodeBlock
                    label="sha256 of the body"
                    value={e.signing.bodySha256 ?? '(no body)'}
                    maxHeight="max-h-16"
                  />
                  {e.status === 401 && (
                    <p className="text-sm text-muted-foreground">
                      The platform refused the signature: compare this string with details.stringToSign of the error
                      body below. The same string means a wrong secret; a different one shows which line differs.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The SDK signs inside @qubiq-psp/sdk; the backend sees the string only when the platform refuses the
                  signature (401 api_auth_failed).
                </p>
              )}
            </Section>
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Request sent">
                <div className="flex flex-col gap-3">
                  <CodeBlock
                    label="Headers (the secret is never here)"
                    value={headersText(e.requestHeaders)}
                    maxHeight="max-h-60"
                  />
                  <CodeBlock label="Body" value={e.requestBody === null ? '(no body)' : prettyJson(e.requestBody)} />
                </div>
              </Section>
              <Section title="Answer received">
                <div className="flex flex-col gap-3">
                  <CodeBlock
                    label="Headers"
                    value={e.responseHeaders ? headersText(e.responseHeaders) : '(no answer)'}
                    maxHeight="max-h-60"
                  />
                  <CodeBlock
                    label={e.responseBodyTruncated ? 'Body (cut to 256 KB)' : 'Body'}
                    value={e.responseBody === null ? '(no body)' : prettyJson(e.responseBody)}
                    maxHeight="max-h-[32rem]"
                  />
                </div>
              </Section>
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
