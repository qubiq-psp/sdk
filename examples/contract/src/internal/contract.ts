// The contract and the Merchant API rendition as data: operations, examples and JSON Schema validation (ajv, 2020-12).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Ajv2020 as Ajv2020Class, ErrorObject } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';
import { parse } from 'yaml';

// ajv is CommonJS: required, so that the default export means the same under every moduleResolution of a consumer
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js') as typeof Ajv2020Class;
const addFormats = require('ajv-formats') as FormatsPlugin;

type Json = Record<string, unknown>;

const read = (file: string): string => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

export const contractDocument = parse(read('openapi.yaml')) as Json;
export const merchantApiDocument = JSON.parse(read('merchant-api.v1.json')) as Json;

const CONTRACT_ID = 'https://contract.psp-examples.local/openapi.yaml';
const MERCHANT_API_ID = 'https://contract.psp-examples.local/merchant-api.v1.json';
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

export interface OperationInfo {
  operationId: string;
  method: string;
  /** Path template, e.g. `/api/v1/invoices/{invoiceId}`. */
  path: string;
  /** JSON pointer of the operation in its document. */
  pointer: string;
  op: Json;
}

const escape = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

function operationsOf(doc: Json): OperationInfo[] {
  const paths = doc['paths'] as Record<string, Record<string, Json>>;
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => METHODS.includes(method))
      .map(([method, op]) => ({
        operationId: String(op['operationId']),
        method: method.toUpperCase(),
        path,
        pointer: `#/paths/${escape(path)}/${method}`,
        op,
      })),
  );
}

export const contractOperations = operationsOf(contractDocument);
export const merchantOperations = operationsOf(merchantApiDocument);

export const contractOperation = (operationId: string): OperationInfo => {
  const found = contractOperations.find((o) => o.operationId === operationId);
  if (!found) throw new Error(`no operation ${operationId} in the contract`);
  return found;
};

export const merchantOperation = (operationId: string): OperationInfo => {
  const found = merchantOperations.find((o) => o.operationId === operationId);
  if (!found) throw new Error(`no operation ${operationId} in the Merchant API`);
  return found;
};

/** The 27 Merchant API operationIds. */
export const MERCHANT_OPERATION_IDS = merchantOperations.map((o) => o.operationId);

/** Resolves a local `$ref` of the given document. */
export function resolveLocal(doc: Json, ref: string): Json {
  let node: unknown = doc;
  for (const raw of ref.replace(/^#/, '').split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Json | undefined)?.[key];
  }
  if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  return node as Json;
}

const deref = (doc: Json, node: Json): Json =>
  typeof node['$ref'] === 'string' ? resolveLocal(doc, node['$ref']) : node;

/** Names of the query parameters of a Merchant API operation. */
export function merchantQueryNames(operationId: string): Set<string> {
  const { op } = merchantOperation(operationId);
  const params = ((op['parameters'] as Json[] | undefined) ?? []).map((p) => deref(merchantApiDocument, p));
  return new Set(params.filter((p) => p['in'] === 'query').map((p) => String(p['name'])));
}

/** The JSON schema of the request body of a Merchant API operation, or null. */
export function merchantBodySchema(operationId: string): Json | null {
  const { op } = merchantOperation(operationId);
  if (!op['requestBody']) return null;
  const body = deref(merchantApiDocument, op['requestBody'] as Json);
  const schema = ((body['content'] as Json)['application/json'] as Json | undefined)?.['schema'] as Json | undefined;
  return schema ? deref(merchantApiDocument, schema) : null;
}

/** The documented answers of a Merchant API operation: status → media type → example (or examples by name). */
export function merchantResponse(operationId: string, status: string): Json | undefined {
  const { op } = merchantOperation(operationId);
  return (op['responses'] as Record<string, Json>)[status];
}

export function successStatuses(operationId: string): number[] {
  const { op } = merchantOperation(operationId);
  return Object.keys(op['responses'] as Json)
    .filter((c) => c.startsWith('2'))
    .map(Number);
}

/** The example of a 2xx answer (a deep copy). */
export function merchantExample(operationId: string, status: number, media = 'application/json'): unknown {
  const content = merchantResponse(operationId, String(status))?.['content'] as Record<string, Json> | undefined;
  const example = content?.[media]?.['example'];
  if (example === undefined) throw new Error(`no example of ${operationId} ${status} ${media}`);
  return structuredClone(example);
}

/** A documented error example `{errorCode, errorMessage, details}` of the operation, if there is one for the code. */
export function merchantErrorExample(operationId: string, errorCode: string): { status: number; body: Json } | null {
  const { op } = merchantOperation(operationId);
  for (const [status, response] of Object.entries(op['responses'] as Record<string, Json>)) {
    const media = (response['content'] as Record<string, Json> | undefined)?.['application/json'];
    const examples = media?.['examples'] as Record<string, Json> | undefined;
    const example = examples?.[errorCode]?.['value'] as Json | undefined;
    if (example) return { status: Number(status), body: structuredClone(example) };
    const single = media?.['example'] as Json | undefined;
    if (single && single['errorCode'] === errorCode) return { status: Number(status), body: structuredClone(single) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ validation

const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contractDocument, CONTRACT_ID);
ajv.addSchema(merchantApiDocument, MERCHANT_API_ID);

/** Validates a value against the schema at a JSON pointer of the contract; returns the errors (empty — valid). */
export function validateAt(pointer: string, value: unknown): string[] {
  const validate = ajv.getSchema(`${CONTRACT_ID}${pointer}`);
  if (!validate) throw new Error(`no schema at ${pointer}`);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
}

/** Validates a value against `#/components/schemas/<name>` of the contract. */
export const validateSchema = (name: string, value: unknown): string[] =>
  validateAt(`#/components/schemas/${name}`, value);

/** Validates a value against a schema of merchant-api.v1.json (`#/components/schemas/<name>` or any pointer). */
export function validateMerchantApi(pointer: string, value: unknown): string[] {
  const validate = ajv.getSchema(`${MERCHANT_API_ID}${pointer}`);
  if (!validate) throw new Error(`no schema at ${pointer}`);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
}

/**
 * Validates the body of a contract response: the schema of `status` (or its class `4XX`/`5XX`, or `default`) and
 * the media type of the contract operation. Returns the errors; a response the contract does not describe is an error.
 */
export function validateResponse(operationId: string, status: number, contentType: string, body: unknown): string[] {
  const { op, pointer } = contractOperation(operationId);
  const responses = op['responses'] as Record<string, Json>;
  const code = [String(status), `${String(status)[0]}XX`, 'default'].find((c) => c in responses);
  if (!code) return [`${operationId}: the contract has no answer ${status}`];
  let base = `${pointer}/responses/${code}`;
  let response = responses[code] as Json;
  if (typeof response['$ref'] === 'string') {
    base = response['$ref'];
    response = resolveLocal(contractDocument, base);
  }
  const content = response['content'] as Record<string, Json> | undefined;
  if (!content) return body === undefined || body === '' ? [] : [`${operationId} ${status}: the contract has no body`];
  const media = Object.keys(content).find((m) => contentType.toLowerCase().startsWith(m));
  if (!media)
    return [`${operationId} ${status}: content type ${contentType} is not one of ${Object.keys(content).join(', ')}`];
  return validateAt(`${base}/content/${escape(media)}/schema`, body);
}
