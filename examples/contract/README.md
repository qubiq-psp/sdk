# Examples contract

The HTTP contract between the one example UI (`examples/ui`) and the two example backends:

| Backend                                   | What it shows                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `examples/plain/api` (`backend: "plain"`) | Signing Merchant API requests, widget links and webhook checks by hand, no SDK |
| `examples/sdk/api` (`backend: "sdk"`)     | The same with `@qubiq-psp/sdk` (NestJS)                                        |

The UI talks to a backend through this contract only, so the same UI build works with either backend. QA tests every
merchant-facing feature of the platform through these deployed examples.

| File                                           | What it is                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`openapi.yaml`](openapi.yaml)                 | The contract, OpenAPI 3.1                                                                                                                                                                       |
| [`merchant-api.v1.json`](merchant-api.v1.json) | Generated: the Merchant API schemas the contract `$ref`s, an OpenAPI 3.1 rendition of the vendored copy `packages/node/api/openapi.v1.json` (see [Merchant API schemas](#merchant-api-schemas)) |
| [`src/openapi.d.ts`](src/openapi.d.ts)         | Generated: TypeScript types of the contract (openapi-typescript)                                                                                                                                |
| [`src/routes.json`](src/routes.json)           | Generated: every route — `operationId`, `method`, `path`, `merchantApi`, `sdkMethod`, `extra`                                                                                                   |
| [`src/conformance/`](src/conformance)          | The conformance suite every backend runs (see [Conformance suite](#conformance-suite))                                                                                                          |
| [`src/fake-gateway/`](src/fake-gateway)        | The fake Merchant API the suite runs against; also for the backends' own tests                                                                                                                  |
| [`types/`](types)                              | Generated: declarations of `./conformance` and `./fake-gateway` for consumers that cannot compile the sources                                                                                   |
| [`scripts/sync.mjs`](scripts/sync.mjs)         | Writes the generated files; `--check` fails when one is stale                                                                                                                                   |
| [`test/`](test)                                | The static coverage tests, the fake gateway's self-tests, and the suite run against a minimal reference backend (`test/reference-backend.ts`)                                                   |

## Package

`@psp-examples/contract` is a private workspace package with no build step. The UI and the backends add
`"@psp-examples/contract": "workspace:*"` and import:

```ts
import type { components, operations, paths } from '@psp-examples/contract/types';
import routes from '@psp-examples/contract/routes.json' with { type: 'json' };

type Config = components['schemas']['Config'];
type Invoice = components['schemas']['V1Invoice']; // Merchant API schemas come along
type CreateInvoiceBody = operations['createInvoice']['requestBody']['content']['application/json'];
```

`./types` is types only (`src/openapi.d.ts`), so it costs nothing at run time; it resolves through `exports` (Vite,
`moduleResolution` `bundler`/`node16`) and through `typesVersions` (NestJS with the classic `node` resolution). It is
generated with `defaultNonNullable: false`: a property with a `default` that is not `required` stays optional
(`CheckoutLinkInput.expiresInSeconds?`), so a caller does not have to send the default itself.
`./routes.json` suits a typed fetch client, the sdk backend's dispatch table and tests; `./openapi.yaml` and
`./merchant-api.v1.json` are exported for contract tests and Swagger UI. `./conformance` and `./fake-gateway` are
TypeScript sources (ESM) that vitest in a consumer runs as they are, with declarations in `types/` for the consumer's
`tsc` (any `moduleResolution`, `module: commonjs` too).

| Script                | What it does                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contract:sync`  | Regenerates `merchant-api.v1.json` from `../../packages/node/api/openapi.v1.json`, then `src/openapi.d.ts` and `src/routes.json` from `openapi.yaml`, then `types/`. Run it after `api:sync` of the SDK, after editing `openapi.yaml` or `src/` |
| `pnpm contract:check` | Fails when any generated file differs byte for byte from what `contract:sync` would write                                                                                                                                                       |
| `pnpm lint`           | `redocly lint` of `openapi.yaml` (recommended rules, `redocly.yaml`)                                                                                                                                                                            |
| `pnpm typecheck`      | `tsc` over the generated types and the tests                                                                                                                                                                                                    |
| `pnpm test`           | vitest: the coverage tests, the fake gateway's self-tests, the suite against the reference backend                                                                                                                                              |
| `pnpm ci`             | All of the above; the root `pnpm ci` runs it                                                                                                                                                                                                    |

## Ground rules

- **One merchant per deployment.** The API URL, key and secret come from the backend's environment; the UI never sees
  the secret. Testnet only: with `APP_TESTNET_ONLY=true` (set in every deployment) a backend refuses to start with a
  `psp_pk_live_` key.
- **Same origin.** The UI calls relative URLs. nginx serves the UI and routes `/api/*` and `/webhooks/*` to the backend.
- **Access** is nginx basic auth in front of everything except `POST /webhooks/psp`, which the platform must reach
  without credentials. Authentication is not part of the contract. A passthrough `401` from the platform has no
  `WWW-Authenticate` header, so it does not trigger the browser's basic-auth prompt; backends must not add one.
- **JSON** everywhere, except `text/csv` of the statement and `text/event-stream` of `/api/stream`.
- **Timeouts.** The platform answers any request within 180 s (gateway docs 13.10), so backends wait up to
  `APP_UPSTREAM_TIMEOUT_MS` (default 180 000) per attempt and nginx `proxy_read_timeout` on `/api/` must be longer.
  `/api/stream` needs `proxy_buffering off`.
- **No calls of its own.** A backend calls the platform only to serve a contract request — nothing at start-up, no
  background polling — so every request-log entry belongs to a `callId`.

## Environment (both backends)

| Variable                  | Required | What                                                                                   |
| ------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `PSP_API_URL`             | yes      | Merchant API base URL (testnet)                                                        |
| `PSP_API_KEY`             | yes      | `psp_pk_test_…`; `psp_pk_live_…` — refused at start when `APP_TESTNET_ONLY=true`       |
| `PSP_API_SECRET`          | yes      | `psp_sk_test_…`                                                                        |
| `PSP_API_PREVIOUS_SECRET` | no       | The previous secret during a rotation; the receiver accepts webhooks signed with it    |
| `PSP_CHECKOUT_URL`        | yes      | Origin of the payment page, e.g. `https://pay.psp.qubiq.cc`                            |
| `APP_PUBLIC_URL`          | no       | Public URL of this deployment; gives `webhookUrl` in `/api/config`                     |
| `APP_TESTNET_ONLY`        | no       | `true` — refuse to start with a `psp_pk_live_` key. Every deployment sets it           |
| `APP_UPSTREAM_TIMEOUT_MS` | no       | Timeout of one platform attempt, ms; default 180 000 (the conformance suite sets 1500) |

The `PSP_*` names are the ones `@qubiq-psp/sdk` reads itself; `APP_*` are the examples' own.

## Routes

### Passthrough — one route per Merchant API operation

`/api/v1/<path>` of the Merchant API is `/api/<path>` here, with the same method. The contract `operationId` equals the
Merchant API `operationId`, `x-merchant-api` names it explicitly, and `x-sdk-method` names the `@qubiq-psp/sdk` method
the sdk backend calls for it (and reports as `sdkMethod` in the request log).

| Area                    | Contract route                                        | Merchant API operation           | `x-sdk-method`                     |
| ----------------------- | ----------------------------------------------------- | -------------------------------- | ---------------------------------- |
| Account                 | `GET /api/account`                                    | `getAccount`                     | `psp.account.get`                  |
| Invoices                | `POST /api/invoices`                                  | `createInvoice`                  | `psp.invoices.create`              |
|                         | `GET /api/invoices`                                   | `listInvoices`                   | `psp.invoices.list`                |
|                         | `GET /api/invoices/{invoiceId}`                       | `getInvoice`                     | `psp.invoices.get`                 |
|                         | `GET /api/invoices/{invoiceId}/events`                | `listInvoiceEvents`              | `psp.invoices.listEvents`          |
|                         | `POST /api/invoices/{invoiceId}/cancel`               | `cancelInvoice`                  | `psp.invoices.cancel`              |
| Balances and operations | `GET /api/balances`                                   | `getMerchantBalances`            | `psp.balances.get`                 |
|                         | `GET /api/operations`                                 | `listMerchantOperations`         | `psp.operations.list`              |
|                         | `GET /api/operations/summary`                         | `getMerchantOperationsSummary`   | `psp.operations.getSummary`        |
|                         | `GET /api/operations/statement` (`format=csv` — CSV)  | `getMerchantOperationsStatement` | `psp.operations.getStatement`      |
|                         | `GET /api/operations/{operationId}`                   | `getMerchantOperation`           | `psp.operations.get`               |
| Deposits                | `GET /api/deposits`                                   | `listMerchantDeposits`           | `psp.deposits.list`                |
|                         | `GET /api/deposits/{depositId}`                       | `getMerchantDeposit`             | `psp.deposits.get`                 |
| Payouts                 | `POST /api/payouts/quote`                             | `quotePayout`                    | `psp.payouts.quote`                |
|                         | `POST /api/payouts`                                   | `createPayout`                   | `psp.payouts.create`               |
|                         | `GET /api/payouts`                                    | `listPayouts`                    | `psp.payouts.list`                 |
|                         | `GET /api/payouts/{payoutId}`                         | `getPayout`                      | `psp.payouts.get`                  |
|                         | `POST /api/payouts/{payoutId}/cancel`                 | `cancelPayout`                   | `psp.payouts.cancel`               |
| Networks and tariff     | `GET /api/networks`                                   | `listNetworks`                   | `psp.networks.list`                |
|                         | `GET /api/tariff`                                     | `getMerchantTariff`              | `psp.tariff.get`                   |
| Webhook settings        | `GET /api/webhook`                                    | `getWebhookSettings`             | `psp.webhook.get`                  |
|                         | `PUT /api/webhook`                                    | `setWebhookUrl`                  | `psp.webhook.setUrl`               |
|                         | `DELETE /api/webhook`                                 | `removeWebhookUrl`               | `psp.webhook.removeUrl`            |
|                         | `POST /api/webhook/test`                              | `sendTestWebhook`                | `psp.webhook.sendTest`             |
|                         | `GET /api/webhook/deliveries`                         | `listDeliveries`                 | `psp.webhook.deliveries.list`      |
|                         | `GET /api/webhook/deliveries/{deliveryId}`            | `getDelivery`                    | `psp.webhook.deliveries.get`       |
|                         | `POST /api/webhook/deliveries/{deliveryId}/redeliver` | `redeliverDelivery`              | `psp.webhook.deliveries.redeliver` |

### Example routes — exist only in the examples (`x-example-extra: true`)

| Route                                          | operationId             | What                                                                                                                                                 |
| ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`                              | `getConfig`             | `backend` (`plain`/`sdk`), versions, `net`, `apiUrl`, `keyId`, `previousSecretSet`, `checkoutUrl`, `webhookUrl`, `serverTime`. No part of the secret |
| `POST /api/invoices/{invoiceId}/checkout-link` | `createCheckoutLink`    | Signed payment-widget link: `{ branding?, locale?, expiresInSeconds? }` → `{ url, token, expiresAt }`                                                |
| `GET /api/request-log`                         | `listRequestLog`        | Requests to the platform, newest first; filters `source`, `operationId`, `callId`, `status`; pages                                                   |
| `GET /api/request-log/{entryId}`               | `getRequestLogEntry`    | One request with headers and bodies                                                                                                                  |
| `DELETE /api/request-log`                      | `clearRequestLog`       | Clear the log                                                                                                                                        |
| `GET /api/stream`                              | `streamEvents`          | SSE: `ready`, `request`, `webhook`                                                                                                                   |
| `GET /api/received-webhooks`                   | `listReceivedWebhooks`  | Webhooks that reached the receiver; filters `invoiceId`, `webhookId`, `event`, `result`; pages                                                       |
| `GET /api/received-webhooks/{receivedId}`      | `getReceivedWebhook`    | One webhook: headers, raw body, verification, our answer                                                                                             |
| `DELETE /api/received-webhooks`                | `clearReceivedWebhooks` | Clear the log (and the duplicate memory)                                                                                                             |
| `GET /api/receiver`                            | `getReceiverSettings`   | How the receiver answers                                                                                                                             |
| `PUT /api/receiver`                            | `setReceiverSettings`   | `{ mode: auto/fixed, status, delayMs, failNext }` — to produce retries, `failed` deliveries and redeliveries on purpose                              |
| `POST /webhooks/psp`                           | `receivePspWebhook`     | The receiver; called by the platform (`x-caller: platform`)                                                                                          |

Example routes never call the platform and never write request-log entries.

## Passthrough rules

**Request — the backend forwards, it does not validate.** Platform validation errors (`invalid_schema`,
`amount_out_of_range`, …) must reach the UI as the platform produced them, so a backend:

- puts the path ids into the Merchant API path, percent-encoded as one segment;
- forwards **every** query parameter, known or not; plain forwards the query string byte for byte (it is what gets
  signed), sdk passes the parameters to the SDK method, which rebuilds the same string;
- forwards the JSON body: plain the received bytes, sdk the parsed value (re-serialised by the SDK); no body in — no
  body out;
- forwards `X-Client-Request-Id` when the UI sends it;
- does **not** forward `X-Example-Source`: it only tags the request-log entries (see [Request log](#request-log)).

One known difference: `PUT /api/webhook` in sdk is `psp.webhook.setUrl(body.url)`, so only `url` reaches the platform;
plain forwards the body as received, extra fields included.

The only checks before the platform call are those the SDK makes itself before sending (it throws `TypeError`); the
plain backend makes the same ones, so both backends answer the same `400 example_invalid_request` without a platform
call: a body that is not JSON, `X-Client-Request-Id` outside `^[\x21-\x7E]{1,128}$`, a path id that is empty, `.` or
`..`.

**Response — status, body and headers unchanged.**

- The HTTP status of the platform: `201` vs `200` on `createInvoice`/`createPayout` (new vs an idempotent repeat with
  the same `externalId`), `202` on `setWebhookUrl`/`removeWebhookUrl`, every error status. sdk takes the success
  status from `getResponseMeta(result).status` and the error status from `PspApiError.status`.
- The body: JSON-equal to the platform's (sdk re-serialises it; key order and whitespace may differ). The statement in
  `format=csv` is the platform's text, byte for byte, `Content-Type: text/csv`.
- The headers `X-Request-Id`, `X-Client-Request-Id`, `X-Api-Key-Deprecated`, `Retry-After` when the platform sent them.
  `X-Api-Key-Deprecated` is how the Account screen shows that the key is the previous one.
- Plus `X-Example-Call-Id` (uuid) on **every** passthrough response — success, platform error or backend-own error.
  The request-log entries of that call have it as `callId`: the UI links an action to its log entries with
  `GET /api/request-log?callId=…`.

**Attempts.** plain makes exactly one attempt per call. sdk keeps the SDK's default retry policy (gateway docs 13.10),
because that is what a merchant gets: one call may produce several attempts, each one its own log entry with `attempt`
1, 2, …, and the UI gets the outcome of the last. On repeated `503`/`429`/timeouts one UI action can therefore take
minutes (backoff up to 60 s between attempts, up to 180 s per attempt): the UI shows the call as pending and the
attempts appear in the log over SSE as they happen. There is no switch to turn retries off.

**The CSV statement in sdk.** `psp.operations.getStatement({ ..., format: 'csv' })` returns the body as a string, and
`getResponseMeta()` has nothing for a string. The status is always `200` on success, and the headers to pass through
(`X-Request-Id`, `X-Client-Request-Id`, `X-Api-Key-Deprecated`) come from what the backend's `fetch` wrapper captured
for the last attempt of the call — the same capture that fills the request log (`onResponse` alone gives the status
and `X-Request-Id`, not the other headers).

## Errors

Every error body has the platform's shape `{ errorCode, errorMessage, details }`.

| Source       | How the UI tells                                                  | Status and body                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The platform | `errorCode` without the `example_` prefix; `X-Request-Id` present | Exactly as the platform sent it — every `errorCode` with its `details`, including `401 api_auth_failed` (with `details.stringToSign` at `bad_signature`), `429`, `503 maintenance` with `Retry-After` |
| The backend  | `errorCode` starts with `example_`                                | One of the codes below                                                                                                                                                                                |

| `errorCode`                     | Status | When                                                                                                        | `details`                            |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `example_invalid_request`       | 400    | Refused before any platform call (see above); bad widget-link options; bad receiver settings or log filters | `{ field, message }` (see below)     |
| `example_not_found`             | 404    | Unknown route, request-log entry or received webhook                                                        | `null`                               |
| `example_upstream_timeout`      | 504    | No answer from the platform in time                                                                         | `{ timeoutMs }`                      |
| `example_upstream_unreachable`  | 502    | No answer at all: connection refused or closed before the answer, DNS or TLS failure                        | `{ cause }`                          |
| `example_upstream_bad_response` | 502    | An answer that is not the platform's: a redirect, a non-JSON error body, an empty 2xx body                  | `{ status, requestId, bodyPreview }` |
| `example_internal_error`        | 500    | A bug in the backend                                                                                        | `null`                               |

`details.field` of `example_invalid_request` names the refused input the same way in both backends: for the JSON body,
the dotted path from its root (`branding.logoUrl`, `expiresInSeconds`, `mode`), `body` for the body as a whole
(not JSON, not an object); otherwise the name of the path parameter, query parameter or header as the contract spells
it (`invoiceId`, `status` of the request-log filter, `X-Client-Request-Id`). The UI shows the error under the input of
that name.

The sdk backend maps SDK errors this way: `PspApiError` (and `PspAuthError`) → the platform status and
`{ errorCode, errorMessage, details }` from the error, headers from `error.headers`; `PspTimeoutError` →
`example_upstream_timeout`; `PspConnectionError` → `example_upstream_unreachable`; `PspUnexpectedResponseError` →
`example_upstream_bad_response`; `TypeError` from an SDK method → `example_invalid_request`. Unlike the earlier
`examples/api`, it does **not** turn a platform `401` into a `502`: QA has to see `api_auth_failed` as it is.

## Request log

Every attempt the backend sends to the Merchant API is one entry, written when the attempt ends (with or without an
answer). Entries are kept in memory, at least the last 1000; a restart clears them. No entry ever contains the API
secret.

`RequestLogItem` (list, SSE `request`):

| Field                                                                          | plain      | sdk     |
| ------------------------------------------------------------------------------ | ---------- | ------- |
| `id`, `callId`, `createdAt`, `durationMs`                                      | yes        | yes     |
| `source` — `poll` when the call had `X-Example-Source: poll`, else `ui`        | yes        | yes     |
| `operationId` — Merchant API operationId                                       | yes        | yes     |
| `sdkMethod` — `x-sdk-method` of the route, e.g. `invoices.create`              | `null`     | yes     |
| `attempt`                                                                      | always `1` | 1, 2, … |
| `method`, `path` (with the query, as signed)                                   | yes        | yes     |
| `status`, `errorCode`, `requestId`, `clientRequestId`, `apiKeyDeprecatedUntil` | yes        | yes     |
| `transportError` `{ code: timeout/network, message }` when there was no answer | yes        | yes     |

**Auto-refresh.** The UI sends `X-Example-Source: poll` on calls it makes by itself (refreshing an invoice, the
deliveries…). Their entries get `source: "poll"`; `GET /api/request-log?source=ui` hides them. SSE emits them like any
other entry; the UI filters them on its side.

`RequestLogEntry` (`GET /api/request-log/{entryId}`) adds `url`, `requestHeaders` (with the signature headers
`X-Api-Key`, `X-Api-Timestamp`, `X-Api-Nonce`, `X-Api-Signature`), `requestBody`, `responseHeaders`, `responseBody`
(cut to 256 KB, `responseBodyTruncated`) and `signing`:

- plain — always `{ stringToSign, bodySha256 }`: what it signed. At `401 bad_signature` the UI compares it with
  `details.stringToSign` of the platform;
- sdk — `null`, except at `401 api_auth_failed`, where `PspAuthError.localStringToSign` fills it.

The sdk backend captures the headers and bodies with the SDK's `fetch` option (a wrapper of the global `fetch`) and
the SDK method name with request-scoped context; `onResponse` alone does not give headers or bodies.

## SSE stream

`GET /api/stream`, `text/event-stream`:

```text
retry: 3000

event: ready
data: {"backend":"sdk","serverTime":"2026-11-17T12:00:00.000Z"}

event: request
id: 0b1e2c3d-…
data: {"id":"0b1e2c3d-…","callId":"7c2d…","operationId":"createInvoice","sdkMethod":"invoices.create","attempt":1,"method":"POST","path":"/api/v1/invoices","status":201,…}

event: webhook
id: 5f6a…
data: {"id":"5f6a…","webhookId":"c650…","event":"invoice.paid","verifyResult":"ok","duplicate":false,"responseStatus":200,…}

: ping
```

- `ready` — once per connection; `request` — a new `RequestLogItem`; `webhook` — a new `ReceivedWebhookItem`.
- `data:` is one line of JSON; `id:` is the entry id. A `: ping` comment every 20 s keeps proxies from closing the
  connection. Response headers `Cache-Control: no-store` and `X-Accel-Buffering: no`.
- There is no replay (`Last-Event-ID` is ignored): after a reconnect the UI refetches the lists.

## Webhook receiver

`POST /webhooks/psp` — the URL to set with `PUT /api/webhook` is `webhookUrl` of `/api/config`.

The platform's delivery id (`id` of a delivery, `deliveryId` of `/api/webhook/deliveries/{deliveryId}`) is the
notification id: equal to `X-Webhook-Id` and to `id` of the body, the same in every attempt and redelivery
(webhook-service docs 13.2, 13.13). So `GET /api/received-webhooks?webhookId={deliveryId}` lists what the receiver got
of a delivery, and a redelivery of an accepted webhook is a `duplicate`.

1. The backend reads the raw body bytes before any parsing (up to 1 MB).
2. It verifies them by webhook-service docs 13.6 with `PSP_API_SECRET`, and `PSP_API_PREVIOUS_SECRET` if set — sdk
   with `verifyWebhook()` without `expectedMerchantId`, plain by the same steps. The result is `ok` or the first failed
   step, in the SDK's words: `missing_header`, `bad_timestamp`, `timestamp_out_of_window`, `bad_signature_header`,
   `signature_mismatch` (→ `401`), `bad_body`, `id_mismatch`, `type_mismatch`, `unsupported_version` (→ `400`),
   `chain_mismatch` (→ `401`). Each entry also stores `signatureValid` (even when a later step failed),
   `signedWith`, the clock skew and the expected `v1=` signature (sdk — `signWebhook()`).
3. A valid webhook whose `X-Webhook-Id` was already accepted with `2xx` is a `duplicate`.
4. The answer follows `ReceiverSettings`:
   - `auto` — `200 { received: true, duplicate }` on `ok`, the status above with `{ errorCode, errorMessage }` otherwise;
   - `failNext > 0` — this webhook gets `status` with `{ forced: "fail_next" }`, and `failNext` goes down by one;
   - `fixed` — always `status` with `{ forced: "fixed" }`;
   - `delayMs` — the pause before any answer (the platform gives up after 10 s: `timeout`).
5. Every request is stored in the received-webhooks log (at least the last 500, in memory) and sent as the SSE event
   `webhook`, whatever the outcome. Settings live in memory and reset to
   `{ mode: auto, status: 500, delayMs: 0, failNext: 0 }` on restart.

## Payment widget link

`POST /api/invoices/{invoiceId}/checkout-link` builds `{PSP_CHECKOUT_URL}/#v1.<payload>.<signature>` offline (gateway
docs 20.2–20.3): sdk with `psp.checkout.createUrl()`, plain with its own HMAC. The input is the options of
`createUrl()`: `branding` (`companyName` 1–64, `logoUrl` https ≤ 1024, `accentColor` `#rrggbb`, `theme`, `title` 1–100),
`locale` (`ru`/`en`), `expiresInSeconds` (1–604800, optional, default 86400). Options the SDK rejects are
`400 example_invalid_request` from both backends. The backend does not check that the invoice exists: the payment page
does when it opens. The UI shows `url` in an `<iframe allow="clipboard-write">` (or `<PspCheckout url>`), allows
`checkoutUrl` in its `frame-src` and checks `event.origin` of the page's messages against it.

## Merchant API schemas

The contract does not redefine Merchant API shapes. Passthrough parameters, request bodies and success schemas are
`$ref`s into `merchant-api.v1.json`, and the platform error is its `ErrorResponse`.

`merchant-api.v1.json` is generated from the SDK's vendored copy `packages/node/api/openapi.v1.json` (kept in sync
with gateway by `api:sync`/`api:check` of the SDK). Gateway publishes OpenAPI **3.0** (`nullable: true`), which is not
valid inside a 3.1 document, and keeps parameters, request bodies and list schemas inline in `paths`, which gives
unstable names in bundles and generated types. The rendition changes only that:

- `openapi: 3.1.0`; `nullable: true` → `type: [T, "null"]` (and `null` added to an `enum`), or
  `anyOf: [schema, { type: "null" }]` where there is no `type`;
- inline operation objects → named components: `parameters/<operationId>.<name>`, `requestBodies/<operationId>`,
  `schemas/<operationId>Body`, `schemas/<operationId>Response` (the operations `$ref` them; nothing else changes);
- `info.x-generated-from` holds the source path and its sha256.

It is regenerated by `pnpm contract:sync` whenever the copy changes (after `api:sync` of the SDK);
`pnpm contract:check` fails when it is stale. One deliberate deviation in the contract itself:
the copy declares the `V1Statement` object for `text/csv` too; the contract declares a string, so the generated
`operations['getMerchantOperationsStatement']['responses'][200]['content']` is
`{ 'application/json': V1Statement; 'text/csv': string }` — the UI types its CSV call by the `text/csv` entry.

## Coverage

1. **Contract** (`test/`, in `pnpm ci` now):
   - `coverage.test.ts` — the `x-merchant-api` values of `openapi.yaml` equal the operationIds of
     `packages/node/api/openapi.v1.json` (27), each once; every other operation has `x-example-extra: true`; each
     passthrough route is `/api/<path>` with the same method, the same parameters (`in` and `name`, in order, plus
     `X-Example-Source` first), the same request body (presence, `required`, media types), the same success statuses
     and media types, `4XX` and `5XX`; every `$ref` resolves; the rendition has the same operations as the copy.
   - `sdk-methods.test.ts` — every passthrough route has a distinct `x-sdk-method`, and calling that method of the SDK
     (from `packages/node/src`, against a stub `fetch`) sends exactly the Merchant API method and path of the route.
2. **Backends** — every backend runs the [conformance suite](#conformance-suite); its last test reads the whole
   request log and fails unless the `operationId`s of the entries cover all 27 operations of the copy.

## What both backends guarantee

- [ ] Every route of `openapi.yaml`, with these paths, methods and shapes.
- [ ] Passthrough: forward without validating (only the pre-checks above); status, body and the four headers unchanged.
- [ ] `X-Example-Call-Id` on every passthrough response; matching `callId` in the request log.
- [ ] Platform errors unchanged; own errors only with `example_*` codes and the platform's error shape.
- [ ] One request-log entry per attempt, with the fields above; SSE `request` for each, SSE `webhook` for each received
      webhook.
- [ ] The receiver: raw-body verification, the SDK's reason codes and statuses, duplicates, `ReceiverSettings`.
- [ ] Widget links by gateway docs 20.2–20.3 with the SDK's option rules.
- [ ] Never expose the secret or any part of it: not in `/api/config`, not in the logs, not in errors.
- [ ] Accept webhooks signed with `PSP_API_PREVIOUS_SECRET` when it is set (sdk: the SDK reads the variable itself;
      plain: checks both secrets) and report `signedWith: "previous"`.
- [ ] Refuse to start with a `psp_pk_live_` key when `APP_TESTNET_ONLY=true`.
- [ ] No platform calls except to serve a contract request.

All of this is checked by the conformance suite — see the next section.

## Conformance suite

`@psp-examples/contract/conformance` is the single definition of "implements the contract". A backend's test file
starts the backend against a fake Merchant API and runs the suite:

```ts
// examples/<plain|sdk>/api/test/conformance.test.ts
import { describe, it } from 'vitest';
import {
  defineConformanceSuite,
  expectStartRefusesLiveKey,
  type ConformanceEnv,
} from '@psp-examples/contract/conformance';
import { startServer } from '../src/server'; // your own: builds the app from an env object and listens on port 0

async function start(env: ConformanceEnv) {
  const app = await startServer({ env, port: 0, host: '127.0.0.1' }); // throws on a live key with APP_TESTNET_ONLY=true
  return { baseUrl: app.url, stop: () => app.close() };
}

defineConformanceSuite({ name: 'plain', start }); // or 'sdk'

describe('testnet guard', () => {
  it('refuses to start with a psp_pk_live_ key', () => expectStartRefusesLiveKey(start));
});
```

- `start(env)` gets the whole environment as an object (`PSP_API_URL` — the fake gateway, `PSP_API_KEY`,
  `PSP_API_SECRET`, `PSP_API_PREVIOUS_SECRET`, `PSP_CHECKOUT_URL`, `APP_PUBLIC_URL`, `APP_TESTNET_ONLY=true`,
  `APP_UPSTREAM_TIMEOUT_MS=1500`) and must use it instead of `process.env`, so that two instances can run in one
  process. It resolves when the backend listens and rejects when it refuses to start.
- The suite starts its own fake gateway, the backend once, and stops both at the end. It makes the requests in
  order (one file, sequential tests), takes about 4 s, and needs the backend's state fresh at start.
- Vitest settings: nothing special; the package's own run uses `maxWorkers: 2`.

What the suite checks (each answer body is also validated against the contract schemas with ajv, JSON Schema 2020-12):

| Area                  | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start                 | No platform calls before the first contract request; `DELETE /api/request-log` empties the log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/api/config`         | Schema; `backend` = the suite's `name`, `net: testnet`, `keyId`, `checkoutUrl`, `webhookUrl` = `{APP_PUBLIC_URL}/webhooks/psp`, `previousSecretSet`, `sdkVersion` (sdk: a string, plain: `null`); no 6-character piece of the secret anywhere in the JSON                                                                                                                                                                                                                                                                                                                                              |
| 27 passthrough routes | One call each: the fake gateway saw a correctly signed request of that operation with the method, path, every query parameter (as pairs) and the JSON body sent to the backend; status, body (JSON-equal; CSV byte for byte) and `X-Request-Id`, `X-Client-Request-Id`, `X-Api-Key-Deprecated`, `Retry-After` equal the platform's last answer; `X-Example-Call-Id`; `X-Example-Source` and `X-Example-Call-Id` not forwarded                                                                                                                                                                          |
| Passthrough details   | CSV statement; `createInvoice` 201 → 200 (idempotent repeat) → 409 `invoice_conflict` with `details.invoiceId`; `createPayout` 201 → 200; `cancelInvoice` without a body sends none; `setWebhookUrl` 202; `X-Client-Request-Id` forwarded, echoed, logged; `X-Api-Key-Deprecated`; `X-Example-Source: poll` → `source: poll`, `?source=ui` hides it; an unknown query parameter and an unknown body field are forwarded and the platform's `400 invalid_schema` comes back                                                                                                                             |
| Platform errors       | `404`, `401 api_auth_failed` (no `WWW-Authenticate`), `429` with `Retry-After`, `503 maintenance`, `409 payout_conflict` — unchanged; a call the sdk retries (persistent `429` with `Retry-After: 0`): every attempt logged under one `callId`, the last answer passed through; plain makes exactly one attempt                                                                                                                                                                                                                                                                                        |
| Request log           | Per call: one entry per platform attempt with `callId`, `source`, `operationId`, `sdkMethod` (= `x-sdk-method` for sdk, `null` for plain), `attempt` 1…n, `method`, `path` as sent, `status`, `errorCode`, `requestId`, `clientRequestId`, `apiKeyDeprecatedUntil`; the entry's signature headers and bodies equal what the gateway got; plain: `signing.stringToSign` equals the gateway's string; sdk: `signing` null (except at a `401 api_auth_failed`); no secret; filters `operationId`, `status`, `source`, `callId`, pages                                                                     |
| Own errors            | Not-JSON body and bad `X-Client-Request-Id` → `400 example_invalid_request` without a platform call; a slow platform → `504 example_upstream_timeout` (`details.timeoutMs`), a closed connection → `502 example_upstream_unreachable`, an HTML `502` → `502 example_upstream_bad_response` (`details.status`) — each with `X-Example-Call-Id` and its log entry (`transportError` `timeout`/`network`, or the status); unknown route, log entry, received webhook → `404 example_not_found`; a bad log filter → `400`                                                                                  |
| SSE                   | `ready` (with `backend`), a `request` event for a call (`id:` = entry id, also for `poll` calls), a `webhook` event for a received webhook; schemas                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Receiver              | Valid → `200 {received: true, duplicate: false}`, logged `ok`/`current` with the raw body, `expectedSignature`, invoice fields; same `X-Webhook-Id` again → `duplicate: true`; another secret → `401 signature_mismatch`; 10 min old → `401 timestamp_out_of_window` with `signatureValid: true`; previous secret → `200`, `signedWith: previous`; no signature → `401 missing_header`; body id ≠ header → `400 id_mismatch`; `chain: mainnet` → `401 chain_mismatch`; `/api/receiver` defaults, `fixed`, `failNext` counting down, `delayMs`, bad settings → `400`; `?result=failed`; `DELETE` clears |
| Widget link           | `url` = `{PSP_CHECKOUT_URL}/#{token}`; the token verifies with the secret (gateway 20.2, the verifier is tested on the 20.4 vectors) with `k`, `i`, `b`, `l`, `e` = now + `expiresInSeconds`, `expiresAt` = `e`; defaults 24 h without `b`/`l`; no platform call; bad branding, `expiresInSeconds` > 604 800, an upper-case id → `400 example_invalid_request`                                                                                                                                                                                                                                         |
| Coverage              | The request log holds all 27 operationIds; every platform request was correctly signed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Where the contract leaves a choice to the backend, the suite checks only the guarantee: the number of attempts for
sdk (at least one, all logged), header name case in `requestHeaders`, key order in JSON, the text of `errorMessage`.

### Fake gateway

`@psp-examples/contract/fake-gateway` is usable on its own (e.g. in a backend's unit tests or for running the UI
locally):

```ts
import { startFakeGateway, TEST_KEY, TEST_SECRET } from '@psp-examples/contract/fake-gateway';

const gateway = await startFakeGateway(); // 127.0.0.1, a free port; gateway.url is PSP_API_URL
gateway.injectError('createInvoice', 'amount_out_of_range'); // the documented example of the code
gateway.inject('getAccount', { status: 200, json: {...}, headers: { 'X-Api-Key-Deprecated': '…' } });
gateway.inject('sendTestWebhook', { delayMs: 5000 }); // or { destroy: true }, { status: 502, text: '<html>' }
gateway.inject('listNetworks', { status: 429, json: {...}, headers: { 'Retry-After': '0' } }, { times: 'always' });
const sent = await gateway.sendWebhook('http://127.0.0.1:3000/webhooks/psp', { type: 'invoice.paid' });
// options: id (repeat for a duplicate), secret (TEST_PREVIOUS_SECRET, a wrong one), timestamp (old), signature,
// omitHeaders, headers, fields (e.g. { chain: 'mainnet' }), body
gateway.requests; // every request: operationId, target, headers, body, auth {ok, reason, stringToSign}, response
await gateway.close();
```

- Signature: gateway 13.4 steps 5–9 in order (`missing_header`, `malformed_header`, `timestamp_out_of_window` ±300 s,
  `unknown_key`, `bad_signature` with `stringToSign`, `nonce_reused`) → `401 api_auth_failed`. Injections apply only
  to correctly signed requests.
- Then step 12: an unknown query parameter or body field, a missing required field, a bad `X-Client-Request-Id` →
  `400 invalid_schema {fields}`.
- Answers: the documented example of each operation from `merchant-api.v1.json` (valid by its schema — tested), with
  the path id put in; `createInvoice`/`createPayout` keep objects by `externalId` (201, 200, 409 `*_conflict`); the
  statement with `format=csv` is the documented `text/csv` example. Every answer has `X-Request-Id`, echoes a valid
  `X-Client-Request-Id` and `Cache-Control: no-store`.
- Test data: `TEST_KEY`, `TEST_SECRET` (the made-up docs secret with the testnet prefix), `TEST_PREVIOUS_SECRET`,
  `LIVE_KEY`/`LIVE_SECRET`, `TEST_MERCHANT_ID`, `TEST_INVOICE_ID`; helpers `signApiRequest`, `signWebhook`,
  `webhookBody`, `sendWebhook`, `verifyCheckoutToken`.

## Not in the contract

Dropped from merchant-test-ui on purpose: profiles of several merchants and their CRUD, its login and session, the
secret reveal, per-profile hook tokens (`/hooks/:token` → one `/webhooks/psp`), the raw signed-request console
(`POST …/call`) and replay from the log, fetching the gateway OpenAPI, and the request `source` (ui/console/poll/replay).
Dropped from the earlier `examples/api`: its own error shape `{ statusCode, error, message }`, mapping platform `401` to
`502`, and `listAll` routes (SDK paginators; the UI pages with `page`/`limit`).
