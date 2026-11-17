// Example plumbing for the passthrough routes of the contract: each one calls one SDK method and answers with the
// platform's status, body and headers unchanged (examples/contract/README.md, «Passthrough rules»).
import { randomUUID } from 'node:crypto';
import {
  applyDecorators,
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import routes from '@psp-examples/contract/routes.json';
import { getResponseMeta, type RequestOptions } from '@qubiq-psp/sdk';
import type { NextFunction, Request, Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { callContext, type ApiCall } from './call-context';
import { RequestLogService } from './request-log/request-log.service';

/** A route of the contract (examples/contract/src/routes.json). */
export interface ContractRoute {
  operationId: string;
  method: string;
  path: string;
  merchantApi: string | null;
  sdkMethod: string | null;
  extra: boolean;
}

export const CONTRACT_ROUTES: readonly ContractRoute[] = routes;
const PASSTHROUGH = CONTRACT_ROUTES.filter((route) => route.merchantApi !== null && route.sdkMethod !== null);

/** The headers of the platform answer passed through to the UI. */
export const PASSTHROUGH_HEADERS = ['X-Request-Id', 'X-Client-Request-Id', 'X-Api-Key-Deprecated', 'Retry-After'];
export const CALL_ID_HEADER = 'X-Example-Call-Id';

/** `/api/invoices/{invoiceId}` → a RegExp matching one path segment per `{param}`. */
const MATCHERS = PASSTHROUGH.map((route) => ({
  method: route.method,
  re: new RegExp(`^${route.path.replace(/\{\w+\}/g, '[^/]+')}/?$`),
}));

/** `true` for a request to a passthrough route. */
export function isPassthroughRequest(method: string, path: string): boolean {
  return MATCHERS.some((m) => m.method === method && m.re.test(path));
}

/** The request with the call id given to it by {@link assignCallId}. */
export type CallRequest = Request & { exampleCallId?: string };

/**
 * Express middleware, before the body parser: every passthrough response carries `X-Example-Call-Id` — also an error
 * the backend answers before the handler runs (a body that is not JSON).
 */
export function assignCallId(req: CallRequest, res: Response, next: NextFunction): void {
  if (isPassthroughRequest(req.method, req.path)) {
    req.exampleCallId = randomUUID();
    res.setHeader(CALL_ID_HEADER, req.exampleCallId);
  }
  next();
}

const MERCHANT_API_CALL = Symbol('MERCHANT_API_CALL');

/**
 * Marks a passthrough route: `@MerchantApiCall('createInvoice')`. The handler runs inside a call context, so the
 * request log knows which call, operation and SDK method each HTTP attempt of the SDK belongs to.
 */
export function MerchantApiCall(operationId: string): MethodDecorator & ClassDecorator {
  const route = PASSTHROUGH.find((r) => r.merchantApi === operationId);
  if (!route) throw new Error(`${operationId} is not a passthrough route of the contract`);
  return applyDecorators(SetMetadata(MERCHANT_API_CALL, route), UseInterceptors(CallContextInterceptor));
}

@Injectable()
export class CallContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestLogService) private readonly requestLog: RequestLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = this.reflector.get<ContractRoute>(MERCHANT_API_CALL, context.getHandler());
    const req = context.switchToHttp().getRequest<CallRequest>();
    const call: ApiCall = {
      callId: req.exampleCallId ?? randomUUID(),
      source: req.header('x-example-source') === 'poll' ? 'poll' : 'ui',
      operationId: route.merchantApi ?? route.operationId,
      sdkMethod: route.sdkMethod ?? '',
      attempts: new Map(),
      lastResponse: null,
    };
    context.switchToHttp().getResponse<Response>().setHeader(CALL_ID_HEADER, call.callId);
    // Subscribing inside run() starts the handler inside the context; it stays with every await of the SDK call
    return new Observable((subscriber) =>
      callContext.run(call, () =>
        next
          .handle()
          .pipe(
            catchError((err: unknown) => {
              this.requestLog.noteAuthError(call, err);
              return throwError(() => err);
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }
}

/** Copies the passed-through headers of a platform answer. */
function copyHeaders(res: Response, headers: Headers | undefined): void {
  for (const name of PASSTHROUGH_HEADERS) {
    const value = headers?.get(name);
    if (value !== null && value !== undefined) res.setHeader(name, value);
  }
}

/**
 * Answers with what an SDK method returned: `getResponseMeta(result)` gives the platform's status (`201` created now,
 * `200` an idempotent repeat, `202` accepted…) and headers; the body is the result, re-serialised.
 */
export function sendSdkResult(res: Response, result: unknown): void {
  const meta = result !== null && typeof result === 'object' ? getResponseMeta(result) : undefined;
  const captured = callContext.current()?.lastResponse;
  copyHeaders(res, meta?.headers ?? captured?.headers);
  res.status(meta?.status ?? captured?.status ?? 200).json(result);
}

/**
 * Answers with the CSV statement. The SDK returns it as a string, and `getResponseMeta()` has nothing for a string:
 * the status and headers come from what the recording fetch captured for the last attempt of this call.
 */
export function sendCsv(res: Response, csv: string): void {
  const captured = callContext.current()?.lastResponse;
  copyHeaders(res, captured?.headers);
  res
    .status(captured?.status ?? 200)
    .type(captured?.headers.get('content-type') ?? 'text/csv')
    .send(csv);
}

/**
 * `RequestOptions` of the SDK from the contract request: `X-Client-Request-Id` goes to the platform with every attempt.
 * `X-Example-Source` is not forwarded.
 */
export const PspRequestOptions = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestOptions => {
  const clientRequestId = ctx.switchToHttp().getRequest<Request>().header('x-client-request-id');
  return clientRequestId === undefined ? {} : { clientRequestId };
});

/**
 * Every query parameter of the request, in order, for the SDK method: the backend forwards and does not validate.
 * A value with commas (`status=active,paid`) becomes a list, which the SDK joins with a literal comma again (gateway
 * docs 13.7); a repeated parameter becomes a list too.
 */
export const PassthroughQuery = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const url = ctx.switchToHttp().getRequest<Request>().originalUrl;
  const params: Record<string, string | string[]> = {};
  for (const [name, value] of new URLSearchParams(url.slice(url.indexOf('?') + 1 || url.length))) {
    const values = value.includes(',') ? value.split(',') : [value];
    const existing = params[name];
    params[name] =
      existing === undefined && values.length === 1 ? value : [...([] as string[]).concat(existing ?? []), ...values];
  }
  return params;
});
