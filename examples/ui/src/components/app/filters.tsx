import { useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { isoToLocal, localToIso } from '@/lib/format';
import { Field } from './field';

/** A row of filters above a list. */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div role="search" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
      {onReset && (
        <div className="flex items-end">
          <Button variant="ghost" size="sm" onClick={onReset}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

export function TextFilter({
  label,
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  // Typed text is applied on Enter or when the field loses focus: one request per filter, not per key
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim());
  };
  return (
    <Field label={label} hint="Enter to apply">
      {(p) => (
        <Input
          {...p}
          value={draft}
          placeholder={placeholder}
          className={mono ? 'font-mono text-xs' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      )}
    </Field>
  );
}

/** A moment in local time; the value is ISO 8601 UTC. */
export function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  return (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          type="datetime-local"
          value={value ? isoToLocal(value) : ''}
          onChange={(e) => onChange(localToIso(e.target.value) ?? '')}
        />
      )}
    </Field>
  );
}

/** One value of an enum, or any. */
export function EnumFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {(p) => (
        <Select value={value || 'any'} onValueChange={(v) => onChange(v === 'any' ? '' : v)}>
          <SelectTrigger id={p.id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** Several values of an enum: sent comma-separated (`status=paid,overpaid`). */
export function MultiFilter({
  label,
  values,
  options,
  onChange,
  className,
}: {
  label: string;
  values: string[];
  options: readonly string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  return (
    <fieldset className={className ?? 'sm:col-span-2 lg:col-span-4'}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((o) => {
          const id = `${label}-${o}`.replace(/\W+/g, '-');
          return (
            <div key={o} className="flex items-center gap-1.5">
              <Checkbox
                id={id}
                checked={values.includes(o)}
                onCheckedChange={(checked) =>
                  onChange(checked === true ? [...values, o] : values.filter((v) => v !== o))
                }
              />
              <Label htmlFor={id} className="font-mono text-xs font-normal">
                {o}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Auto-refresh of a list: its calls go as `X-Example-Source: poll`, hidden in the request log by default. */
export function AutoRefresh({
  checked,
  onChange,
  seconds,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  seconds: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Checkbox id="auto-refresh" checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      <Label htmlFor="auto-refresh" className="font-normal">
        Refresh every {seconds} s
      </Label>
    </div>
  );
}
