# Changelog

All notable changes to `@qubiq-psp/sdk` are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-11-17

### Added

- The SDK now covers all 27 operations of the merchant API, not only the 13 public ones. New resources:
  - `psp.balances.get` — balances per network and asset and per currency;
  - `psp.operations.list` / `listAll` / `get` / `getSummary` / `getStatement` — operations, their totals and the statement; `getStatement({ …, format: 'csv' })` returns the `text/csv` body as a string;
  - `psp.deposits.list` / `listAll` / `get` — deposits with their credit status and the totals of the filter;
  - `psp.payouts.quote` / `create` / `list` / `listAll` / `get` / `cancel` — payouts;
  - `psp.networks.list` and `psp.tariff.get`.
- `payouts.create` is idempotent by `externalId` and is retried like `invoices.create`. It waits at least 180 s per attempt, even when the client `timeoutMs` is lower; an explicit per-call `timeoutMs` is kept. `payouts.quote` is retried only when it surely did not run.
- Public types of the new objects (`MerchantBalances`, `Operation`, `Statement`, `Deposit`, `Payout`, `PayoutQuote`, `Network`, `Tariff`, …), checked against the OpenAPI schemas.
- Typed `details` of the payout error codes: `limit_exceeded`, `invalid_address`, `own_address`, `insufficient_balance`, `network_fee_too_high`, `payout_conflict`, `network_service_rejected`, `rate_unavailable`.
- `examples/create-payout.ts`.

### Security

- `signWebhook()` accepts only a Unix-seconds timestamp — 1–12 digits as a string, or a non-negative integer — and throws a `TypeError` otherwise, before the secret is used. The API secret keys other HMACs too (the payment-widget token), so signing an arbitrary string from a request header under it could produce one of those. Valid webhook timestamps and the documentation vectors are unaffected.

## 0.2.2 — 2026-11-17

No code changes. The source moved to the repository [qubiq-psp/sdk](https://github.com/qubiq-psp/sdk) (`packages/node`), together with the other package and the examples; the former repository `qubiq-psp/node-sdk` becomes a read-only archive. `repository`, `homepage` and `bugs` in `package.json` point there, so npm provenance matches the repository the package is built from.

## 0.2.1 — 2026-11-10

No code changes: the GitHub organization was renamed from `qubic-psp` to `qubiq-psp`. `repository`, `homepage` and `bugs` in `package.json` point to `github.com/qubiq-psp`, so npm provenance matches the repository the package is built from. This release also validates the npm trusted publisher of the renamed organization.

## 0.2.0 — 2026-11-10

### Breaking

- The error code `merchant_closed` is gone: the platform no longer closes single merchants. It is replaced by two `403` codes, both with `details: null`:
  - `merchant_archived` — the owner archived the merchant in the cabinet (it can restore it there);
  - `account_closed` — the user who owns the merchant is closed.

Migration: wherever you match `merchant_closed` (`isPspApiError(err, 'merchant_closed')`, a `switch` on `err.errorCode`), match `merchant_archived` and `account_closed` instead — `isPspApiError(err, 'merchant_closed')` no longer compiles, but a comparison of `err.errorCode` with the string does, so search the code for it. Both mean that the API key gets no answer until the merchant is restored (`merchant_archived`) or never again (`account_closed`): stop creating invoices with that key and alert a person; do not retry.

### Changed

- `api/openapi.v1.json` and `src/generated/schema.d.ts` are synced with the current public OpenAPI of the platform.

## 0.1.1 — 2026-10-29

No code changes: the first release through npm trusted publishing (OIDC) — GitHub Actions stages the version without a stored token, a maintainer approves it with 2FA.

## 0.1.0 — 2026-10-29

First version.

- `PspClient` with the 13 public operations of the merchant API:
  - `account.get`;
  - `invoices.create` / `list` / `listAll` / `get` / `listEvents` / `listAllEvents` / `cancel`;
  - `webhook.get` / `setUrl` / `removeUrl` / `sendTest`;
  - `webhook.deliveries.list` / `listAll` / `get` / `redeliver`.
- HMAC-SHA256 request signing (scheme `v1`), checked against the vectors of the platform. `signRequest()` for custom HTTP clients.
- Automatic retries by the platform rules, with a fresh signature per attempt. Timeouts, `AbortSignal` support, `clientRequestId`.
- Typed errors: `PspApiError` with `isPspApiError(err, code)` narrowing, `PspAuthError` with signature diagnostics, `PspConnectionError` / `PspTimeoutError` with the outcome, `PspUnexpectedResponseError`.
- Webhook verification:
  - `psp.webhook.verify()`, `verifyWebhook()` and `verifyWebhookSignature()`, with the network check and the previous secret;
  - typed `WebhookEvent`;
  - `signWebhook()` for tests.
- `getResponseMeta()`, the `onResponse` / `onRetry` / `onWarning` hooks, and a warning for requests signed with the previous key.
- Payment widget links: `psp.checkout.createUrl(invoice, { branding, locale })` and `createCheckoutToken()` — a token signed offline with the API secret for the platform payment page in an iframe (`@qubiq-psp/react`).
- ESM and CommonJS builds with type declarations, Node.js 18+, no runtime dependencies.
