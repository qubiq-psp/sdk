const local = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Date and time by the browser's clock: `13 Oct 2026, 11:24:05`. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : local.format(d);
}

/** Time with milliseconds, for events that come in bursts (`resize`). */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-GB')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** JSON with indentation; a string that is not JSON — as it is. */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  // JSON.stringify(undefined) is undefined, whatever its type says
  const json = JSON.stringify(value, null, 2) as string | undefined;
  return json === undefined ? String(value) : json;
}

/** Time left until a moment: `12:34`, `1:02:03`; in the past — with a minus. */
export function formatCountdown(ms: number): string {
  const sign = ms < 0 ? '−' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${sign}${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function shortId(id: string | null | undefined): string {
  return id ? `${id.slice(0, 8)}…` : '—';
}

/** `Record<string, string>` as `Name: value` lines. */
export const headersText = (headers: Record<string, string> | null | undefined): string =>
  headers
    ? Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';

/** `<input type="datetime-local">` value (local time) → ISO 8601 UTC; empty → undefined. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** ISO 8601 → `<input type="datetime-local">` value in local time. */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
