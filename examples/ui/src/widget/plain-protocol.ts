// The message protocol of the payment page, by hand: what the plain build uses instead of @qubiq-psp/react.
//   message = { source: 'psp-checkout', v: 1, type: 'ready' | 'status' | 'resize' | 'error', …fields of the type }

/** The result of checking one window message: `null` — not a message of the payment page at all (extensions, devtools). */
export type MessageCheck =
  | { kind: 'accepted'; type: string; fields: Record<string, unknown> }
  | { kind: 'rejected'; reason: 'origin' | 'source' | 'shape' }
  | null;

const STATUSES: ReadonlySet<unknown> = new Set([
  'active',
  'partially_paid',
  'paid',
  'overpaid',
  'expired',
  'expired_partial',
  'cancelled',
]);
const ERROR_CODES: ReadonlySet<unknown> = new Set(['link_invalid', 'link_expired', 'not_found', 'unavailable']);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The fields of a known message type, or `null` when they are not what the protocol says. */
function fieldsOf(type: unknown, rest: Record<string, unknown>): Record<string, unknown> | null {
  switch (type) {
    case 'ready':
      return STATUSES.has(rest['status']) && isText(rest['invoiceId']) && isText(rest['linkExpiresAt'])
        ? { status: rest['status'], invoiceId: rest['invoiceId'], linkExpiresAt: rest['linkExpiresAt'] }
        : null;
    case 'status': {
      const paidAt = rest['paidAt'] ?? null;
      return STATUSES.has(rest['status']) && isText(rest['invoiceId']) && (paidAt === null || isText(paidAt))
        ? { status: rest['status'], invoiceId: rest['invoiceId'], paidAt }
        : null;
    }
    case 'resize': {
      const h = rest['height'];
      return typeof h === 'number' && Number.isFinite(h) && h > 0 ? { height: h } : null;
    }
    case 'error':
      return ERROR_CODES.has(rest['code']) ? { code: rest['code'] } : null;
    default:
      return null;
  }
}

/**
 * Checks a window message against the frame: accepted only from the link's origin (`event.origin`), from this frame's
 * window (`event.source`), with the body `{ source: "psp-checkout", v: 1, type, … }` and documented fields.
 * A `psp-checkout` body that fails a check is `rejected`: the panel only counts such messages.
 */
export function checkMessage(
  event: { origin: string; source: unknown; data: unknown },
  expected: { origin: string; window: unknown },
): MessageCheck {
  const data = event.data;
  if (!data || typeof data !== 'object' || (data as { source?: unknown }).source !== 'psp-checkout') return null;
  if (event.origin !== expected.origin) return { kind: 'rejected', reason: 'origin' };
  if (expected.window === null || expected.window === undefined || event.source !== expected.window) {
    return { kind: 'rejected', reason: 'source' };
  }
  const { source: _source, v, type, ...rest } = data as Record<string, unknown>;
  if (v !== 1 || typeof type !== 'string') return { kind: 'rejected', reason: 'shape' };
  const fields = fieldsOf(type, rest);
  if (!fields) return { kind: 'rejected', reason: 'shape' };
  return { kind: 'accepted', type, fields };
}

/** The frame height for a `resize` (px of the page content): whole pixels, 160 … 4000. */
export function frameHeight(height: unknown): number | null {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  return Math.min(4000, Math.max(160, Math.ceil(height)));
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The origin of a payment link when it is one of `checkoutOrigin`: `https:` (`http:` on localhost), no login or
 * password, a token after `#`. Otherwise `null`, and the frame is not shown.
 */
export function linkOrigin(url: string, checkoutOrigin: string): string | null {
  let link: URL;
  let page: URL;
  try {
    link = new URL(url);
    page = new URL(checkoutOrigin);
  } catch {
    return null;
  }
  const secure = link.protocol === 'https:' || (link.protocol === 'http:' && LOCAL_HOSTS.has(link.hostname));
  if (!secure || link.username || link.password || link.hash.length <= 1) return null;
  return link.origin === page.origin ? link.origin : null;
}
