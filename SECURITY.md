# Security policy

## Reporting a vulnerability

Please report a vulnerability privately, not in a public issue: on GitHub, open the **Security** tab of this repository
and choose **Report a vulnerability**. Describe the package and version, what an attacker can do, and how to reproduce it.

**Never post an API secret** (`psp_sk_…`), a webhook body with real data or any other credential in a report, an issue
or a pull request. If a secret was exposed, change it in the merchant cabinet at once, with the previous key revoked.

We answer within 3 working days and keep you informed until the fix is released. Please give us a reasonable time to
release a fix before you disclose the issue.

## Supported versions

| Package            | Supported                |
| ------------------ | ------------------------ |
| `@qubiq-psp/sdk`   | the latest minor version |
| `@qubiq-psp/react` | the latest minor version |

Fixes are released as a new version of the package; older versions are not patched.

## Scope

The packages in `packages/` and the examples in `examples/`. A vulnerability of the PSP platform itself (the API, the
payment page, the cabinet) is reported the same way; it reaches the same team.

## How releases are protected

- Every release is built by GitHub Actions from a tag on `main` and published with npm trusted publishing (OIDC): no
  npm token is stored anywhere.
- Every version carries npm provenance: the npm page links it to the commit and the workflow run it was built from.
- A version waits in npm's staged queue until a maintainer approves it with two-factor authentication.
- `pnpm-lock.yaml` may only hold packages from `registry.npmjs.org` with an integrity hash; GitHub Actions are pinned by
  commit.
