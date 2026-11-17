#!/usr/bin/env node
// pnpm check:bundles — after `pnpm build`: the plain bundle carries no @qubiq-psp/* code, the sdk bundle does.
//
// The Vite build already checks the module graph (vite.config.ts, sdkModuleCheck). This script checks the files
// that would be deployed, by markers that only the SDK's code has, with the sdk bundle as the positive control:
// a marker missing from dist/sdk means the marker is wrong, not that dist/plain is clean.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** Strings the minified @qubiq-psp/react keeps and the UI's own code never has. */
const MARKERS = [
  // PSP_CHECKOUT_ORIGIN, the default of `checkoutOrigin`: the UI takes the origin from GET /api/config instead
  'https://pay.psp.qubiq.cc',
  // The name of the package, which the sdk build's widget label shows and nothing in the plain build says
  '@qubiq-psp/react',
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function read(variant) {
  const dir = join(root, 'dist', variant);
  if (!existsSync(dir)) throw new Error(`dist/${variant} is missing: run pnpm build first`);
  return files(dir)
    .filter((f) => /\.(js|css|html)$/.test(f))
    .map((f) => ({ file: f.slice(root.length), text: readFileSync(f, 'utf8') }));
}

const problems = [];
const sdk = read('sdk');
const plain = read('plain');
for (const marker of MARKERS) {
  if (!sdk.some((f) => f.text.includes(marker)))
    problems.push(`dist/sdk lacks the marker ${marker}: the check is broken`);
  for (const f of plain) if (f.text.includes(marker)) problems.push(`${f.file} contains ${marker}`);
}

if (problems.length) {
  console.error(`✗ bundles: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ bundles: dist/plain (${plain.length} files) has no @qubiq-psp/* code; dist/sdk has it`);
