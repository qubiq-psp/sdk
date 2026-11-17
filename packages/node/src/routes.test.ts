// Coverage of the gateway spec: the SDK covers every one of the 27 operations of api/openapi.v1.json.
// A new operation in gateway fails this test until it is added to ROUTES and to a resource.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAYOUT_TIMEOUT_MS, ROUTES, type Route } from './routes';

interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
  idempotent: unknown;
}

const spec = JSON.parse(readFileSync(new URL('../api/openapi.v1.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; 'x-idempotency'?: unknown }>>;
};

const specOperations: SpecOperation[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ['get', 'post', 'put', 'delete', 'patch'].includes(method))
    .map(([method, op]) => ({
      operationId: op.operationId ?? `${method} ${path}`,
      method: method.toUpperCase(),
      path,
      idempotent: op['x-idempotency'],
    })),
);

/** The 27 operationIds of gateway docs/13-merchant-api.md, 13.9. */
const ALL_OPERATIONS = [
  'getAccount',
  'createInvoice',
  'listInvoices',
  'getInvoice',
  'listInvoiceEvents',
  'cancelInvoice',
  'getMerchantBalances',
  'listMerchantOperations',
  'getMerchantOperationsSummary',
  'getMerchantOperationsStatement',
  'getMerchantOperation',
  'listMerchantDeposits',
  'getMerchantDeposit',
  'quotePayout',
  'createPayout',
  'listPayouts',
  'getPayout',
  'cancelPayout',
  'listNetworks',
  'getMerchantTariff',
  'getWebhookSettings',
  'setWebhookUrl',
  'removeWebhookUrl',
  'sendTestWebhook',
  'listDeliveries',
  'getDelivery',
  'redeliverDelivery',
] as const;

describe('coverage of api/openapi.v1.json', () => {
  it('the spec has the 27 operations of 13.9', () => {
    expect(specOperations).toHaveLength(27);
    expect(specOperations.map((o) => o.operationId).sort()).toEqual([...ALL_OPERATIONS].sort());
  });

  it('every operation of the spec is in the SDK, and nothing else', () => {
    const covered = new Set<string>(Object.keys(ROUTES));
    const missing = specOperations.map((o) => o.operationId).filter((id) => !covered.has(id));
    expect(missing, 'new operations in gateway: add them to ROUTES and to a resource').toEqual([]);
    expect(Object.keys(ROUTES).sort()).toEqual(specOperations.map((o) => o.operationId).sort());
  });

  it.each(Object.entries(ROUTES))('%s has the method and path of the spec', (operationId, route) => {
    const op = specOperations.find((o) => o.operationId === operationId);
    expect(op, `${operationId} is not in the spec`).toBeDefined();
    expect({ method: op?.method, path: op?.path }).toEqual({ method: route.method, path: route.path });
  });

  it('no operation of the merchant API takes an Idempotency-Key (13.10)', () => {
    expect(specOperations.filter((o) => o.idempotent !== false && o.idempotent !== undefined)).toEqual([]);
  });
});

describe('retry rules (13.10)', () => {
  const rule = (id: keyof typeof ROUTES): Route['retry'] => (ROUTES[id] as Route).retry;

  it('every GET is safe to repeat', () => {
    const gets = Object.entries(ROUTES).filter(([, r]) => r.method === 'GET');
    expect(gets.filter(([, r]) => r.retry !== 'safe')).toEqual([]);
  });

  it('creates are repeated by externalId, cancels by state; a quote and a test webhook only when not run', () => {
    expect([rule('createInvoice'), rule('createPayout'), rule('cancelInvoice'), rule('cancelPayout')]).toEqual([
      'safe',
      'safe',
      'safe',
      'safe',
    ]);
    expect(rule('quotePayout')).toBe('never');
    expect(rule('sendTestWebhook')).toBe('never');
    expect(rule('redeliverDelivery')).toBe('once');
  });

  it('a payout request waits at least 180 s', () => {
    expect(PAYOUT_TIMEOUT_MS).toBe(180_000);
    expect((ROUTES.createPayout as Route).minTimeoutMs).toBe(PAYOUT_TIMEOUT_MS);
    expect(Object.entries(ROUTES).filter(([, r]) => (r as Route).minTimeoutMs !== undefined)).toHaveLength(1);
  });
});
