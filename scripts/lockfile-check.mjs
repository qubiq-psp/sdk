#!/usr/bin/env node
// pnpm lockfile:check — every package in pnpm-lock.yaml comes from registry.npmjs.org with an integrity hash.
// Replaces lockfile-lint of the former yarn repositories (it does not read pnpm-lock.yaml). Workspace packages
// (`link:`) are allowed; tarballs from other hosts, git and file sources are not.
import { readFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org/';
const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const problems = [];

// The `packages:` section: one block per package, with its `resolution`.
const section = lock.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const blocks = section.split(/\n(?=  \S)/).filter((b) => b.trim());
if (blocks.length === 0) problems.push('no packages section in pnpm-lock.yaml');
for (const block of blocks) {
  const name = block.trim().split('\n')[0].replace(/:$/, '');
  const resolution = block.match(/resolution: \{([^}]*)\}/)?.[1] ?? '';
  const tarball = resolution.match(/tarball: ([^,\s]+)/)?.[1];
  if (/\b(repo|commit|directory|path):/.test(resolution))
    problems.push(`${name}: not from the registry (${resolution.trim()})`);
  else if (tarball && !tarball.startsWith(REGISTRY)) problems.push(`${name}: tarball from ${tarball}`);
  else if (!/integrity: sha512-/.test(resolution)) problems.push(`${name}: no sha512 integrity`);
}
for (const m of lock.matchAll(/(?:version|specifier): ['"]?((?:git\+|github:|file:|https?:)\S+)/g)) {
  problems.push(`a dependency from ${m[1]}`);
}

if (problems.length) {
  console.error(`✗ pnpm-lock.yaml: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ pnpm-lock.yaml: ${blocks.length} packages, all from ${REGISTRY} with sha512 integrity`);
