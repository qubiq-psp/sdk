import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {text}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Name — value pairs in two columns (one on a narrow screen). */
export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A monospace value, e.g. an id or an amount. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs break-all', className)}>{children}</span>;
}
