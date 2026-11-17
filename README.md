# PSP SDK

The public SDK of the PSP payment system and the merchant examples.

| Folder | What it is |
|---|---|
| [`packages/node`](packages/node) | [`@qubiq-psp/sdk`](https://www.npmjs.com/package/@qubiq-psp/sdk) — Node.js SDK for the merchant's backend |
| [`packages/react`](packages/react) | [`@qubiq-psp/react`](https://www.npmjs.com/package/@qubiq-psp/react) — the payment widget for the merchant's frontend |

The history of the former repositories `qubiq-psp/node-sdk` and `qubiq-psp/react-sdk` is kept under their folders;
their release tags are `node-v<version>` and `react-v<version>`. The map of old to new commit ids is in
`docs/import/commit-maps/`.

## Development

Node.js 22 and pnpm (pinned in `package.json`, enabled by `corepack enable`).

```bash
pnpm install            # one lockfile for the whole workspace
pnpm run ci             # lockfile check, then every check of every package
pnpm --filter @qubiq-psp/sdk test
```

`pnpm-lock.yaml` may only hold packages from `registry.npmjs.org` with an integrity hash (`pnpm lockfile:check`).

The types of `@qubiq-psp/sdk` follow the public Merchant API of gateway, `apps/gateway/docs/openapi.public.json` of
`qubiq-psp/psp`: `pnpm api:sync` in `packages/node` takes it from a psp checkout next to this repository and stores a
copy in `packages/node/api/openapi.v1.json`; `pnpm api:check` compares the types with the copy, and the copy with
gateway when psp is checked out.

## Releases

A tag on a commit of `main` releases one package: `node-v<version>` — `@qubiq-psp/sdk`, `react-v<version>` —
`@qubiq-psp/react` (`.github/workflows/release.yml`). The version waits in the staged queue of npmjs.com until a
maintainer approves it with 2FA; it is published with provenance through npm trusted publishing, without a stored token.
