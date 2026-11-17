// The contract, the Merchant API copy and its 3.1 rendition, read once for the tests.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

type Json = Record<string, unknown>;

export interface Operation extends Json {
  operationId: string;
  parameters?: Json[];
  requestBody?: Json;
  responses: Record<string, Json>;
  'x-merchant-api'?: string;
  'x-sdk-method'?: string;
  'x-example-extra'?: boolean;
}

export interface Spec extends Json {
  paths: Record<string, Record<string, Operation>>;
  components: Record<string, Record<string, Json>>;
}

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

export const contract = parse(read('../openapi.yaml')) as Spec;
/** The SDK's copy of the gateway Merchant API (OpenAPI 3.0). */
export const copy = JSON.parse(read('../../../packages/node/api/openapi.v1.json')) as Spec;
/** Its 3.1 rendition that the contract references. */
export const rendition = JSON.parse(read('../merchant-api.v1.json')) as Spec;

export interface Entry {
  method: string;
  path: string;
  op: Operation;
}

export function operations(spec: Spec): Entry[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => (METHODS as readonly string[]).includes(method))
      .map(([method, op]) => ({ method: method.toUpperCase(), path, op })),
  );
}

/** Resolves a `$ref` of the contract: local, or into merchant-api.v1.json. */
export function resolveRef(ref: string): Json {
  const [file, pointer = ''] = ref.split('#');
  const doc: unknown = file === '' ? contract : file === 'merchant-api.v1.json' ? rendition : undefined;
  if (doc === undefined) throw new Error(`unknown file in $ref ${ref}`);
  let node: unknown = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Json | undefined)?.[key];
  }
  if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  return node as Json;
}

export const deref = (node: Json): Json => (typeof node['$ref'] === 'string' ? resolveRef(node['$ref']) : node);

/** `/api/v1/invoices/{invoiceId}` → `/api/invoices/{invoiceId}`. */
export const contractPath = (merchantPath: string): string => merchantPath.replace(/^\/api\/v1\//, '/api/');
