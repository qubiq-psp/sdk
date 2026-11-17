import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NetworkAsset } from '@/lib/networks';

/** A network/asset pair from `GET /api/networks`. */
export function PairSelect({
  id,
  pairs,
  value,
  onChange,
  placeholder = 'Choose',
  allowAny = false,
  describedBy,
}: {
  id: string;
  pairs: NetworkAsset[];
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  /** A first option "Any" with the value `''` (filters). */
  allowAny?: boolean;
  describedBy?: string | undefined;
}) {
  return (
    <Select value={value || (allowAny ? 'any' : '')} onValueChange={(v) => onChange(v === 'any' ? '' : v)}>
      <SelectTrigger id={id} className="w-full" aria-describedby={describedBy}>
        <SelectValue placeholder={pairs.length ? placeholder : 'No networks available'} />
      </SelectTrigger>
      <SelectContent>
        {allowAny && <SelectItem value="any">Any network and asset</SelectItem>}
        {pairs.map((a) => (
          <SelectItem key={a.key} value={a.key}>
            {a.network} · {a.asset}
            {a.contract ? ` (${a.standard})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
