// x-sdk-method of every passthrough route names an SDK method that sends exactly that Merchant API operation.
// The SDK is taken from its sources (packages/node/src): no build is needed.
import { describe, expect, it } from 'vitest';
import { PspClient } from '../../../packages/node/src/index.ts';
import { contractPath, copy, operations } from './load.ts';
import routes from '../src/routes.json' with { type: 'json' };

const ID = '97da92f5-45c0-411b-9ed5-6793b396cd5f';

interface Sent {
  method: string;
  pathname: string;
}

function client(sent: Sent[]): PspClient {
  return new PspClient({
    apiKey: `psp_pk_test_${'A'.repeat(24)}`,
    apiSecret: `psp_sk_test_${'B'.repeat(36)}`,
    baseUrl: 'https://api.psp.example',
    maxRetries: 0,
    onWarning: () => {},
    fetch: async (input, init) => {
      const url = new URL(String(input));
      sent.push({ method: init?.method ?? 'GET', pathname: url.pathname });
      const csv = url.searchParams.get('format') === 'csv';
      return new Response(csv ? 'network,asset\n' : '{}', {
        status: 200,
        headers: { 'Content-Type': csv ? 'text/csv' : 'application/json', 'X-Request-Id': ID },
      });
    },
  });
}

/** `webhook.deliveries.get` → the bound function. */
function methodOf(psp: PspClient, name: string): (...args: unknown[]) => Promise<unknown> {
  const parts = name.split('.');
  const owner = parts.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], psp);
  const fn = (owner as Record<string, unknown> | undefined)?.[parts.at(-1) ?? ''];
  if (typeof fn !== 'function') throw new Error(`no SDK method psp.${name}`);
  return (fn as (...args: unknown[]) => Promise<unknown>).bind(owner);
}

const passthrough = routes.filter((r) => r.merchantApi !== null);
const merchantPath = new Map(operations(copy).map(({ method, path, op }) => [op.operationId, { method, path }]));

describe('x-sdk-method', () => {
  it('is set on every passthrough route, distinct, and absent on the extras', () => {
    const names = passthrough.map((r) => r.sdkMethod);
    expect(names.every((n) => typeof n === 'string')).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(routes.filter((r) => r.extra).every((r) => r.sdkMethod === null)).toBe(true);
  });

  it.each(passthrough)('psp.$sdkMethod sends $merchantApi', async (route) => {
    const sent: Sent[] = [];
    const target = merchantPath.get(route.merchantApi ?? '');
    expect(target).toBeDefined();
    expect(contractPath(target?.path ?? '')).toBe(route.path);
    const ids = (target?.path.match(/\{\w+\}/g) ?? []).map(() => ID);
    // The argument after the path ids: the URL for setUrl, otherwise params (or options for methods without params)
    const rest = route.sdkMethod === 'webhook.setUrl' ? 'https://shop.example/psp/webhooks' : {};
    await methodOf(client(sent), route.sdkMethod ?? '')(...ids, rest);
    expect(sent).toEqual([{ method: target?.method, pathname: target?.path.replace(/\{\w+\}/g, ID) }]);
  });

  it('operations.getStatement with format csv returns the CSV text', async () => {
    const psp = client([]);
    await expect(psp.operations.getStatement({ from: 'a', to: 'b', format: 'csv' })).resolves.toBe('network,asset\n');
  });
});
