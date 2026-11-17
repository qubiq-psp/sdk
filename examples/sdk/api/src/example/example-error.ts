// Errors the backend produces itself (never the platform): the platform's error shape with an `example_*` code
// (examples/contract/README.md, «Errors»).
import type { components } from '@psp-examples/contract/types';

export type ExampleErrorCode = components['schemas']['ExampleErrorCode'];
export type ExampleErrorBody = components['schemas']['ExampleError'];

const STATUS: Record<ExampleErrorCode, number> = {
  example_invalid_request: 400,
  example_not_found: 404,
  example_upstream_timeout: 504,
  example_upstream_unreachable: 502,
  example_upstream_bad_response: 502,
  example_payload_too_large: 413,
  example_internal_error: 500,
};

export class ExampleError extends Error {
  override name = 'ExampleError';
  readonly status: number;

  constructor(
    readonly errorCode: ExampleErrorCode,
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.status = STATUS[errorCode];
  }

  /** `400 example_invalid_request` with `details: { field, message }`. */
  static invalid(field: string, message: string): ExampleError {
    return new ExampleError('example_invalid_request', `${field}: ${message}`, { field, message });
  }

  static notFound(message: string): ExampleError {
    return new ExampleError('example_not_found', message);
  }

  /** `413 example_payload_too_large` with `details: { limitBytes }`. */
  static tooLarge(limitBytes: number): ExampleError {
    return new ExampleError('example_payload_too_large', `The body is larger than ${limitBytes} bytes`, { limitBytes });
  }

  toBody(): ExampleErrorBody {
    return { errorCode: this.errorCode, errorMessage: this.message, details: this.details };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Query = Readonly<Record<string, unknown>>;

/** `page` and `limit` of a log list (1…, 1–200, defaults 1 and 50). */
export function pageParams(query: Query): { page: number; limit: number } {
  const int = (name: string, fallback: number, max: number): number => {
    const raw = query[name];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      throw ExampleError.invalid(name, `must be an integer from 1 to ${max}`);
    }
    return Number(raw);
  };
  return { page: int('page', 1, Number.MAX_SAFE_INTEGER), limit: int('limit', 50, 200) };
}

/** An optional string filter; with `allowed`, one of those values. */
export function stringParam<T extends string>(query: Query, name: string, allowed?: readonly T[]): T | undefined {
  const raw = query[name];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw ExampleError.invalid(name, 'must be given once');
  if (allowed && !(allowed as readonly string[]).includes(raw)) {
    throw ExampleError.invalid(name, `must be one of ${allowed.join(', ')}`);
  }
  return raw as T;
}

export function uuidParam(query: Query, name: string): string | undefined {
  const raw = stringParam(query, name);
  if (raw !== undefined && !UUID_RE.test(raw)) throw ExampleError.invalid(name, 'must be a uuid');
  return raw;
}
