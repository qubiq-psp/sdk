# Contributing

Thank you for helping. This repository holds the PSP SDK packages and the merchant examples:

| Folder           | What it is                                                          |
| ---------------- | ------------------------------------------------------------------- |
| `packages/node`  | `@qubiq-psp/sdk` — the Node.js SDK for the merchant's backend       |
| `packages/react` | `@qubiq-psp/react` — the payment widget for the merchant's frontend |

Security issues are not reported here: see [SECURITY.md](SECURITY.md).

## Setup

Node.js 22 and pnpm, pinned in `package.json`:

```bash
corepack enable
pnpm install
pnpm run ci        # every check of every package, the same as CI
```

## Changes

- Branch from `dev` and open the pull request to `dev`. `main` holds released code only.
- Each package keeps its own `README.md` and `CHANGELOG.md`. A change a user can notice goes to `## Unreleased` of the
  package's changelog, under **Breaking** when it breaks existing code.
- The types of `@qubiq-psp/sdk` follow the public Merchant API: `packages/node/api/openapi.v1.json` is a copy of the
  platform's OpenAPI. Do not edit it or `src/generated/` by hand: `pnpm api:sync <path>` in `packages/node` updates both.
- A new dependency needs a reason in the pull request. Packages come only from `registry.npmjs.org`
  (`pnpm lockfile:check`).
- Commit messages are in English and follow the history: `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`, `ci: …`.
- Documentation and code comments are in English.

## Checks

`pnpm run ci` from the root runs them all. In a package folder:

```bash
pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test
pnpm run build && pnpm run package:check && pnpm run smoke
```

## Releases

Maintainers release by a tag on `main`: `node-v<version>` or `react-v<version>` ([README](README.md#releases)).
