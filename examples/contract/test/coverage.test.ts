// Static coverage: every Merchant API operation has exactly one passthrough route of the same shape.
import { describe, expect, it } from 'vitest';
import routes from '../src/routes.json' with { type: 'json' };
import { contract, contractPath, copy, deref, operations, rendition, resolveRef } from './load.ts';

const merchant = operations(copy);
const all = operations(contract);
const passthrough = all.filter(({ op }) => op['x-merchant-api'] !== undefined);

describe('coverage of the Merchant API', () => {
  it('x-merchant-api values equal the operationIds of the copy, each once', () => {
    const ids = merchant.map(({ op }) => op.operationId).sort();
    expect(ids).toHaveLength(27);
    expect(passthrough.map(({ op }) => op['x-merchant-api']).sort()).toEqual(ids);
  });

  it('every operation is either a passthrough or an example extra', () => {
    for (const { op } of all) {
      expect(op['x-merchant-api'] !== undefined, op.operationId).not.toBe(op['x-example-extra'] === true);
    }
  });

  it('operationIds of the contract are unique', () => {
    const ids = all.map(({ op }) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the rendition has the same operations as the copy', () => {
    const shape = (spec: typeof copy) =>
      operations(spec)
        .map(({ method, path, op }) => `${method} ${path} ${op.operationId}`)
        .sort();
    expect(shape(rendition)).toEqual(shape(copy));
  });

  it('src/routes.json lists every operation of the contract', () => {
    expect(routes.map((r) => r.operationId).sort()).toEqual(all.map(({ op }) => op.operationId).sort());
  });
});

describe.each(merchant)('$method $path', ({ method, path, op: source }) => {
  const route = passthrough.find(({ op }) => op['x-merchant-api'] === source.operationId);

  it('maps onto /api/<path> with the same method and operationId', () => {
    expect(route).toMatchObject({ method, path: contractPath(path) });
    expect(route?.op.operationId).toBe(source.operationId);
  });

  it('has the same parameters, X-Example-Source aside', () => {
    const names = (params: Record<string, unknown>[] | undefined) =>
      (params ?? []).map((p) => deref(p)).map((p) => `${String(p['in'])}:${String(p['name'])}`);
    const own = names(route?.op.parameters).filter((n) => n !== 'header:X-Example-Source');
    expect(own).toEqual(names(source.parameters));
    expect(names(route?.op.parameters)[0]).toBe('header:X-Example-Source');
  });

  it('has the same request body', () => {
    const body = route?.op.requestBody;
    expect(body !== undefined).toBe(source.requestBody !== undefined);
    if (body && source.requestBody) {
      expect(deref(body)['required']).toBe(source.requestBody['required']);
      expect(Object.keys(deref(body)['content'] as object)).toEqual(
        Object.keys(source.requestBody['content'] as object),
      );
    }
  });

  it('has the same success statuses and media types, plus 4XX and 5XX', () => {
    const success = (responses: Record<string, Record<string, unknown>>) =>
      Object.entries(responses)
        .filter(([code]) => code.startsWith('2'))
        .map(([code, r]) => `${code} ${Object.keys((r['content'] as object | undefined) ?? {}).join(',')}`);
    expect(success(route?.op.responses ?? {})).toEqual(success(source.responses));
    expect(Object.keys(route?.op.responses ?? {})).toEqual(expect.arrayContaining(['4XX', '5XX']));
  });

  it('every $ref of the route resolves', () => {
    const refs = JSON.stringify(route?.op).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const ref of refs) expect(() => resolveRef(ref.slice(8, -1))).not.toThrow();
  });
});
