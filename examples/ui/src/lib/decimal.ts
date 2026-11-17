/** A non-negative decimal string, as the Merchant API takes amounts: `50`, `0.5`, `1508.25`. */
export const AMOUNT_RE = /^\d+(\.\d+)?$/;

/** Compares non-negative decimal strings without losing precision. */
export function compareDecimal(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const len = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(len, '0'));
  const y = BigInt(bi + bf.padEnd(len, '0'));
  return x === y ? 0 : x < y ? -1 : 1;
}

/** The amount plus one in its last digit: "other fields with the same externalId" for a `409` conflict test. */
export function bumpAmount(amount: string): string {
  const [i = '0', f = ''] = amount.split('.');
  if (!f) return String(BigInt(i) + 1n);
  const digits = (BigInt(i + f) + 1n).toString().padStart(f.length + 1, '0');
  return `${digits.slice(0, -f.length)}.${digits.slice(-f.length)}`;
}

/** Why an amount cannot be sent: not a decimal string, or more fraction digits than the asset has. */
export function amountProblem(amount: string, asset: { decimals: number } | undefined): string | null {
  if (!AMOUNT_RE.test(amount)) return 'A decimal number: 50, 0.5, 1508.25';
  if (!asset) return null;
  const fraction = amount.split('.')[1] ?? '';
  if (fraction.length > asset.decimals) return `At most ${asset.decimals} digits after the point`;
  return null;
}

/** A hint (not a block) when the amount is outside `min … max`: the platform decides, QA may test the refusal. */
export function limitWarning(
  amount: string,
  min: string | null | undefined,
  max: string | null | undefined,
): string | null {
  if (!AMOUNT_RE.test(amount)) return null;
  if (min && compareDecimal(amount, min) < 0) return `Below the minimum ${min}`;
  if (max && compareDecimal(amount, max) > 0) return `Above the maximum ${max}`;
  return null;
}

/** An `externalId` for tests: `ui-20261013-112405-k3f9` — unique and readable in the logs. */
export function newExternalId(prefix = 'ui', now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${prefix}-${date}-${time}-${rand}`;
}
