import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import routes from '@psp-examples/contract/routes.json';
import { calls, handle, server } from '../../test/msw';
import { CALL_ID } from '../../test/fixtures';
import { ApiError, allRoutes, buildPath, call, callText, queryString, urlOf } from './client';

beforeEach(() => {
  calls.length = 0;
});

describe('routes', () => {
  it('knows every route of the contract', () => {
    expect(allRoutes().map((r) => r.operationId)).toEqual(routes.map((r) => r.operationId));
  });

  it('fills path ids, each percent-encoded as one segment', () => {
    expect(urlOf('getInvoice', { path: { invoiceId: 'a/b c' } })).toBe('/api/invoices/a%2Fb%20c');
    expect(urlOf('redeliverDelivery', { path: { deliveryId: 'd1' } })).toBe('/api/webhook/deliveries/d1/redeliver');
    expect(() => buildPath('/api/invoices/{invoiceId}', {})).toThrow('invoiceId');
  });

  it('sends arrays comma-separated with the commas as they are, and leaves out empty values', () => {
    expect(queryString({ status: ['active', 'partially_paid'], limit: 20, externalId: '', network: undefined })).toBe(
      '?status=active,partially_paid&limit=20',
    );
    expect(queryString({ from: '2026-11-17T12:00:00.000Z' })).toBe('?from=2026-11-17T12%3A00%3A00.000Z');
    expect(queryString(undefined)).toBe('');
  });
});

describe('call', () => {
  it('calls the contract path and method, with X-Example-Source and X-Client-Request-Id, and reads the call id', async () => {
    const res = await call('createInvoice', {
      body: { externalId: 'o-1', network: 'tron', asset: 'USDT', amount: '1' },
      clientRequestId: 'shop-req-1',
    });
    expect(res.meta.status).toBe(201);
    expect(res.meta.callId).toBe(CALL_ID);
    expect(res.meta.requestId).toBe('req-0001');
    expect(res.data.id).toEqual(expect.any(String));
    const sent = calls.at(-1)!;
    expect(sent.method).toBe('POST');
    expect(sent.url.pathname).toBe('/api/invoices');
    expect(sent.headers.get('X-Example-Source')).toBe('ui');
    expect(sent.headers.get('X-Client-Request-Id')).toBe('shop-req-1');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.body).toEqual({ externalId: 'o-1', network: 'tron', asset: 'USDT', amount: '1' });
  });

  it('marks auto-refresh calls with X-Example-Source: poll', async () => {
    await call('getInvoice', { path: { invoiceId: 'i-1' }, source: 'poll' });
    expect(calls.at(-1)!.headers.get('X-Example-Source')).toBe('poll');
  });

  it('sends no body and no Content-Type when there is no body', async () => {
    await call('removeWebhookUrl');
    const sent = calls.at(-1)!;
    expect(sent.method).toBe('DELETE');
    expect(sent.body).toBeUndefined();
    expect(sent.headers.get('content-type')).toBeNull();
  });

  it('does not send the passthrough headers to the example routes', async () => {
    await call('getConfig');
    expect(calls.at(-1)!.headers.get('X-Example-Source')).toBeNull();
  });

  it('passes the query of list routes as the Merchant API reads it', async () => {
    await call('listInvoices', { query: { status: ['paid', 'overpaid'], page: 2, limit: 20 } });
    expect(calls.at(-1)!.url.search).toBe('?status=paid,overpaid&page=2&limit=20');
  });

  it('reads the CSV statement as text', async () => {
    const res = await callText('getMerchantOperationsStatement', {
      query: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', format: 'csv' },
    });
    expect(res.data).toContain('network,asset');
    expect(res.meta.callId).toBe(CALL_ID);
    // The type is the contract's text/csv answer; an operation without one is refused
    expectTypeOf(res.data).toEqualTypeOf<string>();
    // @ts-expect-error getAccount has no text/csv answer in the contract
    expectTypeOf(callText<'getAccount'>).toBeFunction();
  });

  it('turns a platform error into ApiError with errorCode, details and the call id', async () => {
    server.use(
      handle('createInvoice', () => ({
        status: 409,
        body: { errorCode: 'invoice_conflict', errorMessage: 'Other fields', details: { externalId: 'o-1' } },
        headers: { 'X-Api-Key-Deprecated': '2026-11-17T13:00:00.000Z' },
      })),
    );
    const err = await call('createInvoice', {
      body: { externalId: 'o-1', network: 'tron', asset: 'USDT', amount: '2' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.origin).toBe('platform');
    expect(e.errorCode).toBe('invoice_conflict');
    expect(e.details).toEqual({ externalId: 'o-1' });
    expect(e.meta.status).toBe(409);
    expect(e.meta.callId).toBe(CALL_ID);
    expect(e.meta.apiKeyDeprecated).toBe('2026-11-17T13:00:00.000Z');
  });

  it('tells a backend error by the example_ prefix', async () => {
    server.use(
      handle('getAccount', () => ({
        status: 504,
        body: { errorCode: 'example_upstream_timeout', errorMessage: 'No answer', details: { timeoutMs: 180000 } },
      })),
    );
    const e = (await call('getAccount').catch((x: unknown) => x)) as ApiError;
    expect(e.origin).toBe('backend');
    expect(e.errorCode).toBe('example_upstream_timeout');
    expect(e.details).toEqual({ timeoutMs: 180000 });
  });

  it('keeps a body that is not the error shape, and reads Retry-After', async () => {
    server.use(
      http.get(
        '/api/balances',
        () => new HttpResponse('<html>Bad gateway</html>', { status: 502, headers: { 'Retry-After': '30' } }),
      ),
    );
    const e = (await call('getMerchantBalances').catch((x: unknown) => x)) as ApiError;
    expect(e.errorCode).toBe('http_502');
    expect(e.origin).toBe('backend');
    expect(e.bodyText).toContain('Bad gateway');
    expect(e.meta.retryAfter).toBe('30');
  });

  it('reports a backend that does not answer', async () => {
    server.use(http.get('/api/account', () => HttpResponse.error()));
    const e = (await call('getAccount').catch((x: unknown) => x)) as ApiError;
    expect(e.origin).toBe('network');
    expect(e.meta.status).toBe(0);
  });
});
