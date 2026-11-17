import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'muted';

const TONES: Record<Tone, string> = {
  success: 'border-status-success-border bg-status-success-bg text-status-success-fg',
  info: 'border-status-info-border bg-status-info-bg text-status-info-fg',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-fg',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger-fg',
  neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg',
  muted: 'border-status-muted-border bg-status-muted-bg text-status-muted-fg',
};

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function httpTone(status: number | null | undefined): Tone {
  if (!status) return 'danger';
  if (status < 300) return 'success';
  if (status < 500) return 'warning';
  return 'danger';
}

/** An HTTP status; `null`/0 — there was no answer. */
export function HttpStatus({ status, label }: { status: number | null | undefined; label?: string | null }) {
  return <ToneBadge tone={httpTone(status)}>{status || label || 'no answer'}</ToneBadge>;
}

/** A status of an entity with its tone; unknown values are neutral. */
export function StatusBadge({ value, tones }: { value: string | null | undefined; tones: Record<string, Tone> }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <ToneBadge tone={tones[value] ?? 'neutral'}>{value}</ToneBadge>;
}

export const INVOICE_TONES: Record<string, Tone> = {
  active: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overpaid: 'success',
  expired: 'muted',
  expired_partial: 'warning',
  cancelled: 'neutral',
};

export const FINAL_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'overpaid',
  'expired',
  'expired_partial',
  'cancelled',
]);

export const DELIVERY_TONES: Record<string, Tone> = {
  delivered: 'success',
  pending: 'info',
  waiting: 'warning',
  failed: 'danger',
  expired: 'muted',
};

export const PAYOUT_TONES: Record<string, Tone> = {
  pending_approval: 'info',
  approved: 'info',
  dispatched: 'info',
  submitted: 'info',
  confirmed: 'success',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'muted',
  manual_review: 'warning',
};

export const FINAL_PAYOUT_STATUSES: ReadonlySet<string> = new Set([
  'confirmed',
  'failed',
  'rejected',
  'cancelled',
  'expired',
]);

export const DEPOSIT_TONES: Record<string, Tone> = { detected: 'info', confirmed: 'success', dropped: 'danger' };

export const VERIFY_TONES: Record<string, Tone> = { ok: 'success' };

/** `Testnet` or `Mainnet` (real money). */
export function NetBadge({ net }: { net: string }) {
  return net === 'mainnet' ? <ToneBadge tone="danger">Mainnet</ToneBadge> : <ToneBadge tone="info">Testnet</ToneBadge>;
}
