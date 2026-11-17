// pnpm contract:sync — regenerates the derived files of the contract:
//   merchant-api.v1.json  the OpenAPI 3.1 rendition of ../../packages/node/api/openapi.v1.json (the SDK's copy of the
//                         gateway Merchant API, OpenAPI 3.0) that openapi.yaml $refs;
//   src/openapi.d.ts      TypeScript types of the contract (openapi-typescript);
//   src/routes.json       the routes of the contract: operationId, method, path, x-merchant-api, x-sdk-method;
//   types/**/*.d.ts       declarations of ./conformance and ./fake-gateway (tsc -p tsconfig.types.json), for consumers
//                         whose TypeScript settings cannot compile the sources (NestJS with module commonjs).
// pnpm contract:check — exits 1 when any of them differs from what sync would write (run sync and review).
//
// The rendition changes only this (see README, "Merchant API schemas"):
// - `openapi: 3.1.0`; `nullable: true` -> `type: [T, "null"]` (and null added to an enum), or
//   `anyOf: [schema, {type: "null"}]` where there is no `type`;
// - inline parameters, request bodies and 2xx schemas of operations -> named components:
//   parameters/<operationId>.<name>, requestBodies/<operationId>, schemas/<operationId>Body, schemas/<operationId>Response;
// - info.x-generated-from: the source path and its sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'packages/node/api/openapi.v1.json';
const source = resolve(root, '../..', SOURCE);
const check = process.argv.includes('--check');
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

function convertNullable(value) {
  if (Array.isArray(value)) return value.map(convertNullable);
  if (value === null || typeof value !== 'object') return value;
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convertNullable(v)]));
  if (!('nullable' in out)) return out;
  const nullable = out.nullable;
  delete out.nullable;
  if (nullable !== true) return out;
  if (typeof out.type === 'string') {
    out.type = [out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
  }
  // No type (an allOf or $ref wrapper): annotations stay outside, the value or null inside
  const annotations = {};
  for (const key of ['description', 'example', 'title']) {
    if (key in out) {
      annotations[key] = out[key];
      delete out[key];
    }
  }
  return { ...annotations, anyOf: [out, { type: 'null' }] };
}

function liftInline(spec) {
  const components = spec.components;
  const parameters = (components.parameters ??= {});
  const requestBodies = (components.requestBodies ??= {});
  const schemas = components.schemas;
  const put = (store, name, value) => {
    if (name in store) throw new Error(`component ${name} exists already`);
    store[name] = value;
  };
  for (const item of Object.values(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.includes(method)) continue;
      const id = op.operationId;
      op.parameters = (op.parameters ?? []).map((p) => {
        if (p.$ref) return p;
        put(parameters, `${id}.${p.name}`, p);
        return { $ref: `#/components/parameters/${id}.${p.name}` };
      });
      if (op.parameters.length === 0) delete op.parameters;
      if (op.requestBody && !op.requestBody.$ref) {
        for (const media of Object.values(op.requestBody.content ?? {})) {
          if (media.schema && !media.schema.$ref) {
            put(schemas, `${id}Body`, media.schema);
            media.schema = { $ref: `#/components/schemas/${id}Body` };
          }
        }
        put(requestBodies, id, op.requestBody);
        op.requestBody = { $ref: `#/components/requestBodies/${id}` };
      }
      for (const [code, response] of Object.entries(op.responses)) {
        if (!code.startsWith('2')) continue;
        for (const media of Object.values(response.content ?? {})) {
          if (!media.schema || media.schema.$ref) continue;
          const name = `${id}Response`;
          if (!(name in schemas)) schemas[name] = media.schema;
          else if (JSON.stringify(schemas[name]) !== JSON.stringify(media.schema)) {
            throw new Error(`${name}: 2xx answers with different inline schemas`);
          }
          media.schema = { $ref: `#/components/schemas/${name}` };
        }
      }
    }
  }
}

/** The 3.1 rendition of the Merchant API copy, as the text of merchant-api.v1.json. */
function renderMerchantApi(raw) {
  const spec = JSON.parse(raw);
  if (!String(spec.openapi).startsWith('3.0')) throw new Error(`${SOURCE}: expected OpenAPI 3.0, got ${spec.openapi}`);
  const out = convertNullable(spec);
  liftInline(out);
  out.openapi = '3.1.0';
  out.info['x-generated-from'] = {
    file: SOURCE,
    sha256: createHash('sha256').update(raw).digest('hex'),
    transform:
      'openapi 3.1.0; nullable: true -> type [T, "null"] (+ null in enum) or anyOf [schema, {type: null}]; ' +
      'inline parameters, request bodies and 2xx schemas of operations -> components ' +
      '(parameters/<operationId>.<name>, requestBodies/<operationId>, schemas/<operationId>Body, ' +
      'schemas/<operationId>Response)',
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The routes of the contract, as the text of src/routes.json. */
function renderRoutes(contractText) {
  const contract = parse(contractText);
  const routes = [];
  for (const [path, item] of Object.entries(contract.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.includes(method)) continue;
      routes.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        merchantApi: op['x-merchant-api'] ?? null,
        sdkMethod: op['x-sdk-method'] ?? null,
        extra: op['x-example-extra'] === true,
      });
    }
  }
  return `${JSON.stringify(routes, null, 2)}\n`;
}

async function renderTypes() {
  const ast = await openapiTS(pathToFileURL(resolve(root, 'openapi.yaml')));
  const header =
    '// Generated by `pnpm contract:sync` from openapi.yaml with openapi-typescript. Do not edit.\n' +
    '/* eslint-disable */\n';
  return header + astToString(ast);
}

const outputs = [
  ['merchant-api.v1.json', () => renderMerchantApi(readFileSync(source, 'utf8'))],
  // the types read merchant-api.v1.json from disk: in sync mode it is written first
  ['src/openapi.d.ts', renderTypes],
  ['src/routes.json', () => renderRoutes(readFileSync(resolve(root, 'openapi.yaml'), 'utf8'))],
];

/** The declarations tsc writes, as { 'types/…': text }. */
function renderDeclarations() {
  const out = mkdtempSync(join(tmpdir(), 'psp-contract-types-'));
  try {
    execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.types.json', '--outDir', out], {
      cwd: root,
      stdio: 'pipe',
    });
    const files = {};
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else files[join('types', relative(out, path))] = readFileSync(path, 'utf8');
      }
    };
    walk(out);
    return files;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [relative(root, join(dir, e.name))],
  );
}

if (!existsSync(source)) {
  console.error(`No ${source}: the contract needs the SDK's Merchant API copy`);
  process.exit(1);
}
if (check) {
  const stale = [];
  for (const [file, render] of outputs) {
    const path = resolve(root, file);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== (await render())) stale.push(file);
  }
  const declarations = renderDeclarations();
  const present = listFiles(resolve(root, 'types')).sort();
  if (JSON.stringify(present) !== JSON.stringify(Object.keys(declarations).sort())) stale.push('types/ (files)');
  for (const [file, text] of Object.entries(declarations)) {
    const path = resolve(root, file);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(file);
  }
  if (stale.length) {
    console.error(`Stale: ${stale.join(', ')} — run pnpm contract:sync and review the diff`);
    process.exit(1);
  }
  console.log(`contract: ${outputs.map(([f]) => f).join(', ')}, types/ up to date with ${SOURCE} and openapi.yaml`);
} else {
  for (const [file, render] of outputs) writeFileSync(resolve(root, file), await render());
  rmSync(resolve(root, 'types'), { recursive: true, force: true });
  for (const [file, text] of Object.entries(renderDeclarations())) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), text);
  }
  console.log(`contract: wrote ${outputs.map(([f]) => f).join(', ')}, types/`);
}
