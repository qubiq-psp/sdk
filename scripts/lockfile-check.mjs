#!/usr/bin/env node
// pnpm lockfile:check — every package in pnpm-lock.yaml comes from registry.npmjs.org with an integrity hash.
// Replaces lockfile-lint of the former yarn repositories (it does not read pnpm-lock.yaml). Tarballs from other hosts,
// git and file sources are not allowed; `link:` only to a workspace package of this repository (an importer of the
// lockfile), never to a folder outside it. Before the real lockfile the script checks itself on a small sample with
// one problem of each kind, so a broken rule fails the run instead of passing everything.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org/';

/** The blocks of a top-level section (`importers:`, `packages:`), split at their two-space keys. */
function sectionBlocks(lock, name) {
  const section = lock.split(new RegExp(`^${name}:\\s*$`, 'm'))[1]?.split(/^\S/m)[0] ?? '';
  return section.split(/\n(?=  \S)/).filter((b) => b.trim());
}

const keyOf = (block) =>
  block
    .trim()
    .split('\n')[0]
    .replace(/:( \{\})?$/, '')
    .replace(/^['"]|['"]$/g, '');

/** The problems of a pnpm-lock.yaml (v9) text; an empty list — it passes. */
export function lockfileProblems(lock) {
  const problems = [];

  // The `packages:` section: one block per package, with its `resolution`.
  const blocks = sectionBlocks(lock, 'packages');
  if (blocks.length === 0) problems.push('no packages section in pnpm-lock.yaml');
  for (const block of blocks) {
    const name = keyOf(block);
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

  // `link:` — resolved against the folder of its importer, it must name another importer (a workspace package)
  const importers = new Map(sectionBlocks(lock, 'importers').map((block) => [keyOf(block), block]));
  let linksInImporters = 0;
  for (const [folder, block] of importers) {
    for (const m of block.matchAll(/version: ['"]?link:([^'"\s]+)/g)) {
      linksInImporters++;
      const target = posix.normalize(posix.join(folder, m[1]));
      if (posix.isAbsolute(m[1]) || target === '..' || target.startsWith('../')) {
        problems.push(`${folder}: link:${m[1]} points outside the repository`);
      } else if (!importers.has(target)) {
        problems.push(`${folder}: link:${m[1]} is not a workspace package (${target})`);
      }
    }
  }
  if ([...lock.matchAll(/\blink:/g)].length !== linksInImporters) problems.push('a link: outside the importers');

  return problems;
}

/** The rules on a sample: the good one passes, each bad one is found. */
function selfCheck() {
  const sample = (link) =>
    [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '',
      '  .:',
      '    devDependencies: {}',
      '',
      '  packages/a:',
      '    dependencies:',
      '      b:',
      '        specifier: workspace:*',
      `        version: ${link}`,
      '',
      '  packages/b: {}',
      '',
      'packages:',
      '',
      '  x@1.0.0:',
      '    resolution: {integrity: sha512-AAAA}',
      '',
      'snapshots:',
      '',
      '  x@1.0.0: {}',
      '',
    ].join('\n');
  const found = (link, text) => lockfileProblems(sample(link)).some((p) => p.includes(text));
  const failures = [];
  const good = lockfileProblems(sample('link:../b'));
  if (good.length) failures.push(`the good sample fails: ${good.join('; ')}`);
  if (!found('link:../../../elsewhere', 'outside the repository'))
    failures.push('a link outside the repository passes');
  if (!found('link:/etc', 'outside the repository')) failures.push('an absolute link passes');
  if (!found('link:../c', 'not a workspace package')) failures.push('a link to a folder that is no package passes');
  if (!found('git+https://example.com/x.git', 'a dependency from')) failures.push('a git dependency passes');
  if (failures.length) {
    console.error(`✗ lockfile-check self-check:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(2);
  }
}

selfCheck();
const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const problems = lockfileProblems(lock);
if (problems.length) {
  console.error(`✗ pnpm-lock.yaml: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `✓ pnpm-lock.yaml: ${sectionBlocks(lock, 'packages').length} packages, all from ${REGISTRY} with sha512 integrity; ` +
    'link: only to workspace packages',
);
