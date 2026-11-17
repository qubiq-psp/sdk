import { Link } from 'react-router';
import type { components } from '@psp-examples/contract/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DELIVERY_TONES, StatusBadge } from '@/components/app/badges';
import { formatTime, shortId } from '@/lib/format';

type Delivery = components['schemas']['V1Delivery'];

/** Platform deliveries of webhooks: what the platform sent, how many attempts, the last answer. */
export function DeliveryTable({ items }: { items: Delivery[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Attempts</TableHead>
          <TableHead>Last answer</TableHead>
          <TableHead>Invoice</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="text-xs whitespace-nowrap">
              <Link to={`/webhooks/deliveries/${d.id}`} className="underline underline-offset-4">
                {formatTime(d.createdAt)}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {d.type}
              {d.kind === 'test' ? ' (test)' : ''}
            </TableCell>
            <TableCell>
              <StatusBadge value={d.status} tones={DELIVERY_TONES} />
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {d.attempts}/{d.totalAttempts}
              {d.redeliveries ? ` · ${d.redeliveries} resent` : ''}
            </TableCell>
            <TableCell className="text-xs">
              {d.lastHttpStatus ?? d.lastErrorCode ?? '—'}
              {d.nextAttemptAt ? ` · next ${formatTime(d.nextAttemptAt)}` : ''}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {d.invoiceId ? (
                <Link to={`/invoices/${d.invoiceId}`} className="underline underline-offset-4">
                  {shortId(d.invoiceId)}
                </Link>
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
