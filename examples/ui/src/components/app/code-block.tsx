import { scrollFocus } from '@/components/ui/scroll-focus';
import { cn } from '@/lib/cn';
import { prettyJson } from '@/lib/format';
import { CopyButton } from './copy-button';

/** A monospace block that scrolls, with a copy button: bodies, headers, strings to sign. */
export function CodeBlock({
  value,
  label,
  className,
  maxHeight = 'max-h-96',
}: {
  value: string;
  label?: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      {label && <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="relative">
        <pre
          ref={scrollFocus}
          aria-label={label}
          className={cn(
            'overflow-auto rounded-md border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap',
            maxHeight,
          )}
        >
          {value || ' '}
        </pre>
        <CopyButton value={value} className="absolute top-1.5 right-1.5" />
      </div>
    </div>
  );
}

/** Any value as indented JSON. */
export function JsonBlock({ value, label, maxHeight }: { value: unknown; label?: string; maxHeight?: string }) {
  return <CodeBlock value={prettyJson(value)} {...(label ? { label } : {})} {...(maxHeight ? { maxHeight } : {})} />;
}

/** A value in a line with a copy button: an address, an id, a URL. */
export function CopyValue({ value, mono = true, className }: { value: string; mono?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-1', className)}>
      <span className={cn('min-w-0 break-all', mono && 'font-mono text-xs')}>{value}</span>
      <CopyButton value={value} />
    </span>
  );
}
