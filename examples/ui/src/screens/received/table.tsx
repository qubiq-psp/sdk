import { Link } from 'react-router';
import type { components } from '@psp-examples/contract/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { httpTone, INVOICE_TONES, StatusBadge, ToneBadge } from '@/components/app/badges';
import { formatTime, shortId } from '@/lib/format';

type Item = components['schemas']['ReceivedWebhookItem'];

/** Webhooks that reached this backend's receiver: verified or not, why, duplicate, what it answered. */
export function ReceivedTable({ items }: { items: Item[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Received</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Verification</TableHead>
          <TableHead>Our answer</TableHead>
          <TableHead>Invoice</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((w) => (
          <TableRow key={w.id}>
            <TableCell className="text-xs whitespace-nowrap">
              <Link to={`/received/${w.id}`} className="underline underline-offset-4">
                {formatTime(w.receivedAt)}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {w.event ?? '—'}
              {w.attempt ? ` #${w.attempt}` : ''}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-1">
                <ToneBadge tone={w.verifyResult === 'ok' ? 'success' : 'danger'}>
                  {w.verifyResult === 'ok' ? 'verified' : w.verifyResult}
                </ToneBadge>
                {w.signedWith === 'previous' && <ToneBadge tone="warning">previous secret</ToneBadge>}
                {w.duplicate && <ToneBadge tone="neutral">duplicate</ToneBadge>}
              </span>
            </TableCell>
            <TableCell className="text-xs">
              <ToneBadge tone={httpTone(w.responseStatus)}>{w.responseStatus}</ToneBadge>
              {w.responseDelayMs ? ` after ${w.responseDelayMs} ms` : ''}
            </TableCell>
            <TableCell className="text-xs">
              {w.invoiceId ? (
                <span className="flex flex-wrap items-center gap-1">
                  <Link to={`/invoices/${w.invoiceId}`} className="font-mono underline underline-offset-4">
                    {w.externalId ?? shortId(w.invoiceId)}
                  </Link>
                  <StatusBadge value={w.invoiceStatus} tones={INVOICE_TONES} />
                </span>
              ) : (
                '—'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
