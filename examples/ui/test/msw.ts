// MSW handlers of every contract route, typed by the contract. `calls` records which operations were requested and
// with which headers, so tests can check what the UI sent.
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { allRoutes, routeOf, type Ok, type OpId } from '@/api/client';
import * as f from './fixtures';

export interface RecordedCall {
  operationId: string;
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

export const calls: RecordedCall[] = [];

const PASSTHROUGH_HEADERS = { 'X-Example-Call-Id': f.CALL_ID, 'X-Request-Id': 'req-0001' };

type Answer<O extends OpId> = Ok<O> | { status: number; body: unknown; headers?: Record<string, string> };

/** The MSW path of a contract route: `{invoiceId}` → `:invoiceId`. */
const mswPath = (path: string) => path.replace(/\{(\w+)\}/g, ':$1');

/**
 * A handler of one contract route. `answer` is the success body (typed by the contract) or a full answer for
 * errors. Passthrough answers carry `X-Example-Call-Id`, as both backends must send.
 */
export function handle<O extends OpId>(operationId: O, answer: (req: RecordedCall) => Answer<O>) {
  const route = routeOf(operationId);
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
  return http[method](mswPath(route.path), async ({ request }) => {
    const text = await request.text();
    const rec: RecordedCall = {
      operationId,
      method: route.method,
      url: new URL(request.url),
      headers: request.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    calls.push(rec);
    const a = answer(rec);
    const extra = route.extra ? {} : PASSTHROUGH_HEADERS;
    if (a !== null && typeof a === 'object' && 'status' in a && 'body' in a && typeof a.status === 'number') {
      const full = a;
      return HttpResponse.json(full.body as JsonBodyType, {
        status: full.status,
        headers: { ...extra, ...full.headers },
      });
    }
    const status =
      operationId === 'createInvoice' ||
      operationId === 'createPayout' ||
      operationId === 'quotePayout' ||
      operationId === 'sendTestWebhook'
        ? 201
        : 200;
    return HttpResponse.json(a as JsonBodyType, { status, headers: extra });
  });
}

/** A success answer for every route of the contract (the receiver and the stream are not called by fetch). */
export const defaultHandlers = [
  handle('getConfig', () => f.config),
  handle('createCheckoutLink', () => f.checkoutLink),
  handle('listRequestLog', () => ({ items: [f.requestLogItem], page: 1, limit: 50, total: 1 })),
  handle('getRequestLogEntry', () => f.requestLogEntry),
  handle('listReceivedWebhooks', () => ({ items: [f.receivedItem], page: 1, limit: 25, total: 1 })),
  handle('getReceivedWebhook', () => f.received),
  handle('getReceiverSettings', () => f.receiverSettings),
  handle('setReceiverSettings', (req) => req.body as typeof f.receiverSettings),
  // The CSV statement is text; the JSON one is the example
  http.get(mswPath(routeOf('getMerchantOperationsStatement').path), ({ request }) => {
    const url = new URL(request.url);
    calls.push({
      operationId: 'getMerchantOperationsStatement',
      method: 'GET',
      url,
      headers: request.headers,
      body: undefined,
    });
    if (url.searchParams.get('format') === 'csv') {
      return new HttpResponse(f.STATEMENT_CSV, { headers: { 'content-type': 'text/csv', ...PASSTHROUGH_HEADERS } });
    }
    return HttpResponse.json(f.example('getMerchantOperationsStatement') as JsonBodyType, {
      headers: PASSTHROUGH_HEADERS,
    });
  }),
  http.delete(mswPath(routeOf('clearRequestLog').path), () => {
    calls.push({
      operationId: 'clearRequestLog',
      method: 'DELETE',
      url: new URL('http://x'),
      headers: new Headers(),
      body: undefined,
    });
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(mswPath(routeOf('clearReceivedWebhooks').path), () => {
    calls.push({
      operationId: 'clearReceivedWebhooks',
      method: 'DELETE',
      url: new URL('http://x'),
      headers: new Headers(),
      body: undefined,
    });
    return new HttpResponse(null, { status: 204 });
  }),
  ...allRoutes()
    .filter((r) => !r.extra && r.operationId !== 'getMerchantOperationsStatement')
    .map((r) => handle(r.operationId as OpId, () => f.example(r.operationId as OpId))),
];

export const server = setupServer(...defaultHandlers);
