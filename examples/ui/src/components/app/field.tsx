import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

/**
 * A labelled form field: `children` gets the input id and the ids of the hint and the error for
 * `aria-describedby`.
 */
export function Field({
  label,
  hint,
  error,
  warning,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  warning?: string | null | undefined;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {warning && <p className="text-xs text-status-warning-fg">{warning}</p>}
    </div>
  );
}
