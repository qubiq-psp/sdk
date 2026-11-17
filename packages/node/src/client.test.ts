import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiError, KEY, SECRET, startFakeGateway, type FakeGateway, type RecordedRequest } from '../test/fake-gateway';
import { PspClient } from './client';
import { isPspApiError, PspUnexpectedResponseError } from './errors';
import { getResponseMeta } from './transport';

let gw: FakeGateway;
let psp: PspClient;

beforeEach(async () => {
  gw = await startFakeGateway();
  psp = new PspClient({ apiKey: KEY, apiSecret: SECRET, baseUrl: gw.url, retryBaseDelayMs: 1 });
});
afterEach(async () => {
  await gw.close();
});

const last = (): RecordedRequest => {
  const req = gw.requests.at(-1);
  if (!req) throw new Error('no request');
  expect(req.signatureValid).toBe(true);
  return req;
};

describe('account, invoices, webhook', () => {
  it('account.get', async () => {
    gw.queue.push({ json: { merchantId: 'm', serverTime: 1 } });
    expect(await psp.account.get()).toMatchObject({ merchantId: 'm' });
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/account', body: '' });
  });

  it('invoices.create sends the params as the body; meta tells 201 from 200', async () => {
    gw.queue.push({ status: 201, json: { id: 'i1' } }, { status: 200, json: { id: 'i1' } });
    const params = { externalId: 'order-10530', network: 'tron', asset: 'USDT', amount: '50', metadata: { a: 1 } };
    const created = await psp.invoices.create(params);
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/invoices', body: JSON.stringify(params) });
    expect(getResponseMeta(created)?.status).toBe(201);
    expect(getResponseMeta(await psp.invoices.create(params))?.status).toBe(200);
  });

  it('invoices.list builds the query in the order of the params, dates as ISO, lists with a comma', async () => {
    gw.queue.push({ json: { items: [], page: 2, limit: 10, total: 0 } });
    await psp.invoices.list({
      status: ['active', 'partially_paid'],
      from: new Date(Date.UTC(2026, 9, 1)),
      to: '2026-10-28T00:00:00.000Z',
      network: 'tron',
      page: 2,
      limit: 10,
    });
    expect(last().target).toBe(
      '/api/v1/invoices?status=active,partially_paid&from=2026-10-01T00%3A00%3A00.000Z' +
        '&to=2026-10-28T00%3A00%3A00.000Z&network=tron&page=2&limit=10',
    );
  });

  it('invoices.get, listEvents, cancel', async () => {
    await psp.invoices.get('97da92f5-45c0-411b-9ed5-6793b396cd5f');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/invoices/97da92f5-45c0-411b-9ed5-6793b396cd5f' });

    gw.queue.push({ json: { items: [], page: 1, limit: 5, total: 0 } });
    await psp.invoices.listEvents('inv', { limit: 5 });
    expect(last().target).toBe('/api/v1/invoices/inv/events?limit=5');

    await psp.invoices.cancel('inv');
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/invoices/inv/cancel', body: '' });
    await psp.invoices.cancel('inv', { reason: 'Покупатель передумал' });
    expect(last().body).toBe(JSON.stringify({ reason: 'Покупатель передумал' }));
  });

  it('webhook settings: get, setUrl, removeUrl, sendTest', async () => {
    await psp.webhook.get();
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/webhook' });
    await psp.webhook.setUrl('https://shop.example/psp/webhook');
    expect(last()).toMatchObject({ method: 'PUT', body: '{"url":"https://shop.example/psp/webhook"}' });
    await psp.webhook.removeUrl();
    expect(last()).toMatchObject({ method: 'DELETE', target: '/api/v1/webhook', body: '' });
    await psp.webhook.sendTest();
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/webhook/test', body: '' });
    await psp.webhook.sendTest({ message: 'Hello' });
    expect(last().body).toBe('{"message":"Hello"}');
  });

  it('webhook deliveries: list, get, redeliver', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 50, total: 0 } });
    await psp.webhook.deliveries.list({
      status: 'failed',
      kind: 'notification',
      type: ['invoice.paid', 'invoice.overpaid'],
    });
    expect(last().target).toBe(
      '/api/v1/webhook/deliveries?status=failed&kind=notification&type=invoice.paid,invoice.overpaid',
    );
    await psp.webhook.deliveries.get('d1');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/webhook/deliveries/d1' });
    await psp.webhook.deliveries.redeliver('d1');
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/webhook/deliveries/d1/redeliver', body: '' });
  });
});

describe('balances, operations, statement', () => {
  it('balances.get with and without filters', async () => {
    await psp.balances.get();
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/balances', body: '' });
    await psp.balances.get({ network: 'tron', asset: 'USDT' });
    expect(last().target).toBe('/api/v1/balances?network=tron&asset=USDT');
  });

  it('operations.list: types with a comma, dates as ISO, related ids', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 20, total: 0 } });
    await psp.operations.list({
      type: ['deposit_credit', 'payout_hold'],
      payoutId: '9e4c2a7b-1f3d-4b8e-a5c6-3d7f0b2e9a14',
      from: new Date(Date.UTC(2026, 8, 29)),
      asset: 'USDT',
      limit: 20,
    });
    expect(last().target).toBe(
      '/api/v1/operations?type=deposit_credit,payout_hold&payoutId=9e4c2a7b-1f3d-4b8e-a5c6-3d7f0b2e9a14' +
        '&from=2026-09-29T00%3A00%3A00.000Z&asset=USDT&limit=20',
    );
  });

  it('operations.get, getSummary', async () => {
    await psp.operations.get('0f2c7b9e-5a41-4d36-b8e3-9c1d4a6f2e58');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/operations/0f2c7b9e-5a41-4d36-b8e3-9c1d4a6f2e58' });
    await psp.operations.getSummary({ from: '2026-09-29T00:00:00.000Z', to: new Date(Date.UTC(2026, 8, 30)) });
    expect(last().target).toBe(
      '/api/v1/operations/summary?from=2026-09-29T00%3A00%3A00.000Z&to=2026-09-30T00%3A00%3A00.000Z',
    );
  });

  it('operations.getStatement in JSON: an object with meta', async () => {
    gw.queue.push({ json: { merchantId: 'm', from: 'a', to: 'b', items: [] } });
    const statement = await psp.operations.getStatement({
      from: '2026-09-29T00:00:00.000Z',
      to: '2026-09-30T00:00:00.000Z',
      asset: 'USDT',
    });
    expect(statement).toMatchObject({ merchantId: 'm', items: [] });
    expect(getResponseMeta(statement)?.status).toBe(200);
    expect(last().target).toBe(
      '/api/v1/operations/statement?from=2026-09-29T00%3A00%3A00.000Z&to=2026-09-30T00%3A00%3A00.000Z&asset=USDT',
    );
    expect(last().headers['accept']).toBe('application/json');
  });

  it('operations.getStatement in CSV: the text/csv body as a string, byte for byte', async () => {
    const csv = 'network,asset,decimals,opening,closing\r\ntron,USDT,6,0,222.75\r\n';
    gw.queue.push({ raw: csv, headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    const text = await psp.operations.getStatement({
      from: '2026-09-29T00:00:00.000Z',
      to: '2026-09-30T00:00:00.000Z',
      format: 'csv',
    });
    expect(text).toBe(csv);
    expect(last().target).toBe(
      '/api/v1/operations/statement?from=2026-09-29T00%3A00%3A00.000Z&to=2026-09-30T00%3A00%3A00.000Z&format=csv',
    );
    expect(last().headers['accept']).toBe('text/csv, application/json');
  });

  it('a CSV statement: an error is still a JSON PspApiError; an answer that is not CSV is unexpected', async () => {
    gw.queue.push(apiError(400, 'invalid_schema', { fields: [{ field: 'from', message: 'required' }] }));
    const params = { from: '2026-09-30T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z', format: 'csv' } as const;
    await expect(psp.operations.getStatement(params)).rejects.toSatisfy((err) => isPspApiError(err, 'invalid_schema'));

    gw.queue.push({ raw: '<html>login</html>' });
    await expect(psp.operations.getStatement(params)).rejects.toBeInstanceOf(PspUnexpectedResponseError);
  });
});

describe('deposits', () => {
  it('deposits.list: filters, credit statuses with a comma; the page has totals', async () => {
    const totals = [{ network: 'tron', asset: 'USDT', decimals: 6, count: 1, amount: '50' }];
    gw.queue.push({ json: { items: [], page: 1, limit: 50, total: 0, totals } });
    const page = await psp.deposits.list({
      txHash: '9e02f72b8b779953e796456bebf248096ac6084c1d8eecf86d58191165eedb45',
      status: 'confirmed',
      creditStatus: ['aml_wait', 'aml_hold'],
      matchKind: 'late',
    });
    expect(page.totals).toEqual(totals);
    expect(last().target).toBe(
      '/api/v1/deposits?txHash=9e02f72b8b779953e796456bebf248096ac6084c1d8eecf86d58191165eedb45' +
        '&status=confirmed&creditStatus=aml_wait,aml_hold&matchKind=late',
    );
  });

  it('deposits.get; a missing deposit is 404 not_found', async () => {
    await psp.deposits.get('e0b38e4d-4bba-4291-9eb5-6c26144f19c3');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/deposits/e0b38e4d-4bba-4291-9eb5-6c26144f19c3' });
    gw.queue.push(apiError(404, 'not_found', { object: 'deposit', id: 'x' }));
    await expect(psp.deposits.get('x')).rejects.toMatchObject({ status: 404, errorCode: 'not_found' });
  });
});

describe('payouts', () => {
  const payout = {
    externalId: 'w-2290',
    network: 'tron',
    asset: 'USDT',
    amount: '1000',
    toAddress: 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW',
    quoteId: '3d8f1a6c-9b2e-4c75-a0d4-6e1b7c9f2a58',
  };

  it('payouts.quote sends the params as the body; without amount — a quote for the maximum', async () => {
    gw.queue.push({ status: 201, json: { quoteId: 'q1' } });
    const quote = await psp.payouts.quote({ network: 'tron', asset: 'USDT', toAddress: payout.toAddress });
    expect(quote.quoteId).toBe('q1');
    expect(last()).toMatchObject({
      method: 'POST',
      target: '/api/v1/payouts/quote',
      body: JSON.stringify({ network: 'tron', asset: 'USDT', toAddress: payout.toAddress }),
    });
    expect(last().headers['content-type']).toBe('application/json');
  });

  it('payouts.quote: 429 of the quote limit is thrown with retryAfterSeconds, not repeated', async () => {
    gw.queue.push(
      apiError(429, 'too_many_requests', { scope: 'quote', limit: 10, retryAfterSeconds: 0 }, { 'Retry-After': '0' }),
    );
    const err: unknown = await psp.payouts
      .quote({ network: 'tron', asset: 'USDT', toAddress: 'T' })
      .catch((e: unknown) => e);
    if (!isPspApiError(err, 'too_many_requests')) throw new Error('wrong error');
    expect(err.details.scope).toBe('quote');
    expect(err.retryAfterSeconds).toBe(0);
    expect(gw.requests).toHaveLength(1);
  });

  it('payouts.create: meta tells 201 from 200 of a repeat with the same externalId', async () => {
    gw.queue.push({ status: 201, json: { id: 'p1' } }, { status: 200, json: { id: 'p1' } });
    const created = await psp.payouts.create(payout, { clientRequestId: 'shop-req-w-2290-1' });
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/payouts', body: JSON.stringify(payout) });
    expect(last().headers['x-client-request-id']).toBe('shop-req-w-2290-1');
    expect(getResponseMeta(created)?.status).toBe(201);
    expect(getResponseMeta(await psp.payouts.create(payout))?.status).toBe(200);
  });

  it('payouts.create: 409 payout_conflict narrows details to payoutId', async () => {
    gw.queue.push(apiError(409, 'payout_conflict', { payoutId: 'p1' }));
    const err: unknown = await psp.payouts.create(payout).catch((e: unknown) => e);
    if (!isPspApiError(err, 'payout_conflict')) throw new Error('wrong error');
    expect(err.details.payoutId).toBe('p1');
    expect(gw.requests).toHaveLength(1);
  });

  it('payouts.create: 400 insufficient_balance tells maxAmount, not repeated', async () => {
    gw.queue.push(
      apiError(400, 'insufficient_balance', {
        network: 'tron',
        asset: 'USDT',
        available: '500',
        required: '1006',
        maxAmount: '496.517412',
      }),
    );
    const err: unknown = await psp.payouts.create(payout).catch((e: unknown) => e);
    if (!isPspApiError(err, 'insufficient_balance')) throw new Error('wrong error');
    expect(err.details.maxAmount).toBe('496.517412');
    expect(gw.requests).toHaveLength(1);
  });

  it('payouts.list, get, cancel', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 50, total: 0 } });
    await psp.payouts.list({ externalId: 'w-2290', status: ['pending_approval', 'approved'] });
    expect(last().target).toBe('/api/v1/payouts?externalId=w-2290&status=pending_approval,approved');

    await psp.payouts.get('9e4c2a7b-1f3d-4b8e-a5c6-3d7f0b2e9a14');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/payouts/9e4c2a7b-1f3d-4b8e-a5c6-3d7f0b2e9a14' });

    await psp.payouts.cancel('p1');
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/payouts/p1/cancel', body: '' });
    await psp.payouts.cancel('p1', { reason: 'Неверный адрес получателя' });
    expect(last().body).toBe(JSON.stringify({ reason: 'Неверный адрес получателя' }));
  });

  it('payouts.cancel of an approved payout: 409 invalid_state, not repeated', async () => {
    gw.queue.push(
      apiError(409, 'invalid_state', { object: 'payout', id: 'p1', status: 'approved', allowed: ['pending_approval'] }),
    );
    await expect(psp.payouts.cancel('p1')).rejects.toMatchObject({ errorCode: 'invalid_state' });
    expect(gw.requests).toHaveLength(1);
  });
});

describe('networks and tariff', () => {
  it('networks.list, tariff.get', async () => {
    gw.queue.push({ json: { items: [{ network: 'tron', assets: [] }] } });
    expect((await psp.networks.list()).items[0]?.network).toBe('tron');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/networks', body: '' });
    gw.queue.push({ json: { tariffPlanName: 'Standard', rules: [], asOf: 'x' } });
    expect((await psp.tariff.get()).tariffPlanName).toBe('Standard');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/tariff', body: '' });
  });
});

describe('listAll', () => {
  const pageOf = (page: number, ids: string[], total: number) => ({
    json: { items: ids.map((id) => ({ id })), page, limit: 2, total },
  });

  it('walks every page and stops at total', async () => {
    gw.queue.push(pageOf(1, ['a', 'b'], 5), pageOf(2, ['c', 'd'], 5), pageOf(3, ['e'], 5));
    const ids: string[] = [];
    for await (const invoice of psp.invoices.listAll({ status: 'active', limit: 2 })) ids.push(invoice.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(gw.requests.map((r) => r.target)).toEqual([
      '/api/v1/invoices?status=active&limit=2&page=1',
      '/api/v1/invoices?status=active&limit=2&page=2',
      '/api/v1/invoices?status=active&limit=2&page=3',
    ]);
  });

  it('skips an item that moved to the next page because a new one was added on top', async () => {
    gw.queue.push(pageOf(1, ['b', 'a'], 3), pageOf(2, ['a', 'z'], 4));
    const ids: string[] = [];
    for await (const invoice of psp.invoices.listAll({ limit: 2 })) ids.push(invoice.id);
    expect(ids).toEqual(['b', 'a', 'z']);
  });

  it('uses 100 per page by default and stops on an empty page', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 100, total: 7 } });
    const ids: string[] = [];
    for await (const event of psp.invoices.listAllEvents('inv')) ids.push(event.id);
    expect(ids).toEqual([]);
    expect(last().target).toBe('/api/v1/invoices/inv/events?limit=100&page=1');
  });

  it('deliveries.listAll works the same way', async () => {
    gw.queue.push(pageOf(1, ['d1'], 1));
    const ids: string[] = [];
    for await (const delivery of psp.webhook.deliveries.listAll({ kind: 'test' })) ids.push(delivery.id);
    expect(ids).toEqual(['d1']);
  });

  it('operations, deposits and payouts listAll keep the filters on every page', async () => {
    gw.queue.push(pageOf(1, ['o1', 'o2'], 3), pageOf(2, ['o3'], 3));
    const operations: string[] = [];
    for await (const op of psp.operations.listAll({ type: 'deposit_credit', limit: 2 })) operations.push(op.id);
    expect(operations).toEqual(['o1', 'o2', 'o3']);
    expect(gw.requests.map((r) => r.target)).toEqual([
      '/api/v1/operations?type=deposit_credit&limit=2&page=1',
      '/api/v1/operations?type=deposit_credit&limit=2&page=2',
    ]);

    gw.queue.push({ json: { items: [{ id: 'd1' }], page: 1, limit: 100, total: 1, totals: [] } });
    const deposits: string[] = [];
    for await (const deposit of psp.deposits.listAll({ invoiceId: 'inv' })) deposits.push(deposit.id);
    expect(deposits).toEqual(['d1']);
    expect(last().target).toBe('/api/v1/deposits?invoiceId=inv&limit=100&page=1');

    gw.queue.push(pageOf(1, ['p1', 'p2'], 3), pageOf(2, ['p2', 'p3'], 4));
    const payouts: string[] = [];
    for await (const p of psp.payouts.listAll({ status: 'failed', limit: 2 })) payouts.push(p.id);
    expect(payouts).toEqual(['p1', 'p2', 'p3']);
    expect(last().target).toBe('/api/v1/payouts?status=failed&limit=2&page=2');
  });
});

describe('the client itself', () => {
  it('knows the network of the key', () => {
    expect(psp.net).toBe('testnet');
    expect(psp.isLive).toBe(false);
    expect(psp.apiKey).toBe(KEY);
  });

  it('never shows the secret', () => {
    expect(JSON.stringify(psp)).not.toContain(SECRET);
    expect(inspect(psp, { depth: 10, showHidden: true })).not.toContain(SECRET);
    expect(inspect(psp)).toContain(KEY);
  });
});
