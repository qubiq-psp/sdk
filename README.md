# PSP SDK

The official SDK of the PSP payment system and the merchant examples. PSP accepts crypto payments (USDT on TRON and EVM
networks) by invoices and pays out merchants' money; a merchant's server talks to it through the signed Merchant API,
and the buyer pays on the PSP payment page embedded in the merchant's site.

| Package                              | What it is                                                                                                                                     |                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`@qubiq-psp/sdk`](packages/node)    | Node.js SDK for the merchant's backend: signed requests to the Merchant API, typed errors, retries, webhook verification, payment widget links | [![npm](https://img.shields.io/npm/v/@qubiq-psp/sdk)](https://www.npmjs.com/package/@qubiq-psp/sdk)     |
| [`@qubiq-psp/react`](packages/react) | The payment widget for the merchant's frontend: `<PspCheckout>` for React, `mountPspCheckout()` without it                                     | [![npm](https://img.shields.io/npm/v/@qubiq-psp/react)](https://www.npmjs.com/package/@qubiq-psp/react) |

```bash
npm install @qubiq-psp/sdk      # the backend
npm install @qubiq-psp/react    # the frontend
```

Start with the README of each package: [`packages/node`](packages/node/README.md),
[`packages/react`](packages/react/README.md). What changed in each version: [`@qubiq-psp/sdk`](packages/node/CHANGELOG.md),
[`@qubiq-psp/react`](packages/react/CHANGELOG.md).

## Versions

The two packages are versioned independently: each follows [Semantic Versioning](https://semver.org/) and is released
when it changes. Any version of `@qubiq-psp/sdk` works with any version of `@qubiq-psp/react` — they do not depend on
each other; each follows the platform:

| Package            | Follows                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `@qubiq-psp/sdk`   | Merchant API `v1` (`/api/v1/*`), webhook signature `v1`, payment widget link `v1` |
| `@qubiq-psp/react` | the payment page protocol `v1` (the widget link and its `postMessage` events)     |

When a change of the platform needs a matching pair, this table says which versions belong together.

## Security

The API secret lives only on the merchant's server: never in the frontend, the repository or logs. Report a
vulnerability privately — see [SECURITY.md](SECURITY.md). Every release is built here by GitHub Actions and published
with npm provenance.

## Development

Node.js 22 and pnpm (pinned in `package.json`, enabled by `corepack enable`).

```bash
pnpm install            # one lockfile for the whole workspace
pnpm run ci             # lockfile check, then every check of every package
pnpm --filter @qubiq-psp/sdk test
```

`pnpm-lock.yaml` may only hold packages from `registry.npmjs.org` with an integrity hash (`pnpm lockfile:check`).

The types of `@qubiq-psp/sdk` follow the public Merchant API of the platform. `packages/node/api/openapi.v1.json` is a
copy of it: `pnpm api:sync <path>` in `packages/node` updates the copy and the generated types, and `pnpm api:check`
compares the types with the copy.

How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md).

## Releases

A tag on a commit of `main` releases one package: `node-v<version>` — `@qubiq-psp/sdk`, `react-v<version>` —
`@qubiq-psp/react` (`.github/workflows/release.yml`). The version waits in the staged queue of npmjs.com until a
maintainer approves it with 2FA; it is published with provenance through npm trusted publishing, without a stored token.

## History

This repository joins the former `qubiq-psp/node-sdk` (now `packages/node`) and `qubiq-psp/react-sdk` (now
`packages/react`), both archived. Their full history is kept under these folders, their release tags are
`node-v<version>` and `react-v<version>`, and the map of old to new commit ids is in `docs/import/commit-maps/`.

## License

[MIT](LICENSE)
