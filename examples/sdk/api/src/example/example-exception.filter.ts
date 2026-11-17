// Every error becomes an answer of the contract (examples/contract/README.md, «Errors»):
// - a platform error the SDK threw (`PspApiError`, `PspAuthError` included) passes through unchanged: the platform's
//   status, `{ errorCode, errorMessage, details }` and headers — QA sees `401 api_auth_failed` as it is;
// - the SDK's own errors become `example_*` codes: no answer in time, no connection, an answer that is not the API,
//   and a `TypeError` the SDK throws before sending (a bad `X-Client-Request-Id`, a path id `..`);
// - errors of this backend are `example_*` codes too.
// Neither the answer nor the log contains the API secret: SDK messages never include it.
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { PspApiError, PspConnectionError, PspTimeoutError, PspUnexpectedResponseError } from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { ExampleError } from './example-error';
import { CALL_ID_HEADER, PASSTHROUGH_HEADERS } from './passthrough';

/** The body preview of an answer that is not the API's: enough to recognise a proxy page. */
const PREVIEW_CHARS = 512;

@Catch()
export class ExampleExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return; // e.g. the SSE stream after its client left

    // The call id is set on passthrough routes only (see assignCallId / CallContextInterceptor)
    const passthrough = res.getHeader(CALL_ID_HEADER) !== undefined;

    if (exception instanceof PspApiError) {
      for (const name of PASSTHROUGH_HEADERS) {
        const value = exception.headers.get(name);
        if (value !== null) res.setHeader(name, value);
      }
      res.status(exception.status).json({
        errorCode: exception.errorCode,
        errorMessage: exception.errorMessage,
        details: exception.details,
      });
      return;
    }

    const error = this.toExampleError(exception, passthrough);
    if (error.status >= 500) {
      this.#logger.error(
        `${error.errorCode}: ${error.message}`,
        error.errorCode === 'example_internal_error' && exception instanceof Error ? exception.stack : undefined,
      );
    }
    if (exception instanceof PspUnexpectedResponseError) {
      const requestId = exception.headers.get('x-request-id');
      if (requestId !== null) res.setHeader('X-Request-Id', requestId);
    }
    res.status(error.status).json(error.toBody());
  }

  private toExampleError(exception: unknown, passthrough: boolean): ExampleError {
    if (exception instanceof ExampleError) return exception;

    // PspTimeoutError extends PspConnectionError: it goes first
    if (exception instanceof PspTimeoutError) {
      return new ExampleError('example_upstream_timeout', exception.message, { timeoutMs: exception.timeoutMs });
    }
    if (exception instanceof PspConnectionError) {
      // `outcome: 'unknown'` (the connection broke after sending) is in the message: a create may have run
      return new ExampleError('example_upstream_unreachable', exception.message, { cause: exception.message });
    }
    if (exception instanceof PspUnexpectedResponseError) {
      return new ExampleError('example_upstream_bad_response', exception.message, {
        status: exception.status,
        requestId: exception.requestId,
        bodyPreview: exception.body.slice(0, PREVIEW_CHARS),
      });
    }
    // The SDK checks a few things before sending and throws TypeError (e.g. «clientRequestId must be …»)
    if (passthrough && exception instanceof TypeError) {
      return ExampleError.invalid(fieldOf(exception.message), exception.message);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return ExampleError.notFound('No such route');
      if (status >= 400 && status < 500) return ExampleError.invalid('request', exception.message);
    }
    return new ExampleError('example_internal_error', 'Internal error of the example backend');
  }
}

/** The SDK option a TypeError message starts with, as the contract names it. */
function fieldOf(message: string): string {
  const first = /^[A-Za-z.]+/.exec(message)?.[0] ?? 'request';
  return first === 'clientRequestId' ? 'X-Client-Request-Id' : first;
}
