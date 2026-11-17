// Errors of the backend itself. They have the platform's error shape `{ errorCode, errorMessage, details }` and an
// `example_*` code, so the UI tells them from the platform's errors (examples/contract/README.md, "Errors").
import type { FastifyError, FastifyInstance } from 'fastify';
import { bodyLimitOf } from './limits.ts';
import type { ExampleError, ExampleErrorCode } from './types.ts';

export class ExampleHttpError extends Error {
  readonly status: number;
  readonly code: ExampleErrorCode;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: ExampleErrorCode, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ExampleHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ExampleError {
    return { errorCode: this.code, errorMessage: this.message, details: this.details };
  }
}

/** `400 example_invalid_request` — refused before any platform call. */
export const invalidRequest = (field: string, message: string): ExampleHttpError =>
  new ExampleHttpError(400, 'example_invalid_request', `${field}: ${message}`, { field, message });

export const notFound = (message: string): ExampleHttpError => new ExampleHttpError(404, 'example_not_found', message);

/** `413 example_payload_too_large` — a body over the limit of its path. */
export const payloadTooLarge = (limitBytes: number): ExampleHttpError =>
  new ExampleHttpError(413, 'example_payload_too_large', `The body is larger than ${limitBytes} bytes`, {
    limitBytes,
  });

/** Every error leaves as `{ errorCode, errorMessage, details }`; an unexpected one is logged and becomes a 500. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | ExampleHttpError, req, reply) => {
    if (err instanceof ExampleHttpError) return reply.status(err.status).send(err.toBody());
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(payloadTooLarge(bodyLimitOf(req.url)).toBody());
    }
    // Fastify's own 4xx: a body that is not JSON, too large, of an unsupported type
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(400).send(invalidRequest('body', err.message).toBody());
    }
    req.log.error({ err }, 'unhandled error');
    const internal = new ExampleHttpError(500, 'example_internal_error', 'Internal error of the example backend');
    return reply.status(500).send(internal.toBody());
  });
}
