# Examples contract

The HTTP contract between the one example UI (`examples/ui`) and the two example backends:

| Backend | What it shows |
|---|---|
| `examples/plain/api` (`backend: "plain"`) | Signing Merchant API requests, widget links and webhook checks by hand, no SDK |
| `examples/sdk/api` (`backend: "sdk"`) | The same with `@qubiq-psp/sdk` (NestJS) |

The UI talks to a backend through this contract only, so the same UI build works with either backend. QA tests every
merchant-facing feature of the platform through these deployed examples.

| File | What it is |
|---|---|
| [`openapi.yaml`](openapi.yaml) | The contract, OpenAPI 3.1 |
| [`merchant-api.v1.json`](merchant-api.v1.json) | The Merchant API schemas the contract `$ref`s: a generated OpenAPI 3.1 rendition of the vendored copy `packages/node/api/openapi.v1.json` (see [Merchant API schemas](#merchant-api-schemas)) |

## Ground rules

- **One merchant per deployment.** The API URL, key and secret come from the backend's environment; the UI never sees
  the secret. Testnet only: a backend refuses to start with a `psp_pk_live_` key.
- **Same origin.** The UI calls relative URLs. nginx serves the UI and routes `/api/*` and `/webhooks/*` to the backend.
- **Access** is nginx basic auth in front of everything except `POST /webhooks/psp`, which the platform must reach
  without credentials. Authentication is not part of the contract. A passthrough `401` from the platform has no
  `WWW-Authenticate` header, so it does not trigger the browser's basic-auth prompt; backends must not add one.
- **JSON** everywhere, except `text/csv` of the statement and `text/event-stream` of `/api/stream`.
- **Timeouts.** The platform answers any request within 180 s (gateway docs 13.10), so backends wait up to 180 s per
  attempt and nginx `proxy_read_timeout` on `/api/` must be longer. `/api/stream` needs `proxy_buffering off`.

## Environment (both backends)

| Variable | Required | What |
|---|---|---|
| `PSP_API_URL` | yes | Merchant API base URL (testnet) |
| `PSP_API_KEY` | yes | `psp_pk_test_…`; `psp_pk_live_…` — the backend refuses to start |
| `PSP_API_SECRET` | yes | `psp_sk_test_…` |
| `PSP_API_PREVIOUS_SECRET` | no | The previous secret during a rotation; the receiver accepts webhooks signed with it |
| `PSP_CHECKOUT_URL` | yes | Origin of the payment page, e.g. `https://pay.psp.qubiq.cc` |
| `PUBLIC_URL` | no | Public URL of this deployment; gives `webhookUrl` in `/api/config` |

The names are the ones `@qubiq-psp/sdk` reads itself.

## Routes

### Passthrough — one route per Merchant API operation

`/api/v1/<path>` of the Merchant API is `/api/<path>` here, with the same method. The contract `operationId` equals the
Merchant API `operationId`, and `x-merchant-api` names it explicitly.

| Area | Contract route | Merchant API operation |
|---|---|---|
| Account | `GET /api/account` | `getAccount` |
| Invoices | `POST /api/invoices` | `createInvoice` |
| | `GET /api/invoices` | `listInvoices` |
| | `GET /api/invoices/{invoiceId}` | `getInvoice` |
| | `GET /api/invoices/{invoiceId}/events` | `listInvoiceEvents` |
| | `POST /api/invoices/{invoiceId}/cancel` | `cancelInvoice` |
| Balances and operations | `GET /api/balances` | `getMerchantBalances` |
| | `GET /api/operations` | `listMerchantOperations` |
| | `GET /api/operations/summary` | `getMerchantOperationsSummary` |
| | `GET /api/operations/statement` (`format=csv` — CSV) | `getMerchantOperationsStatement` |
| | `GET /api/operations/{operationId}` | `getMerchantOperation` |
| Deposits | `GET /api/deposits` | `listMerchantDeposits` |
| | `GET /api/deposits/{depositId}` | `getMerchantDeposit` |
| Payouts | `POST /api/payouts/quote` | `quotePayout` |
| | `POST /api/payouts` | `createPayout` |
| | `GET /api/payouts` | `listPayouts` |
| | `GET /api/payouts/{payoutId}` | `getPayout` |
| | `POST /api/payouts/{payoutId}/cancel` | `cancelPayout` |
| Networks and tariff | `GET /api/networks` | `listNetworks` |
| | `GET /api/tariff` | `getMerchantTariff` |
| Webhook settings | `GET /api/webhook` | `getWebhookSettings` |
| | `PUT /api/webhook` | `setWebhookUrl` |
| | `DELETE /api/webhook` | `removeWebhookUrl` |
| | `POST /api/webhook/test` | `sendTestWebhook` |
| | `GET /api/webhook/deliveries` | `listDeliveries` |
| | `GET /api/webhook/deliveries/{deliveryId}` | `getDelivery` |
| | `POST /api/webhook/deliveries/{deliveryId}/redeliver` | `redeliverDelivery` |

### Example routes — exist only in the examples (`x-example-extra: true`)

| Route | operationId | What |
|---|---|---|
| `GET /api/config` | `getConfig` | `backend` (`plain`/`sdk`), versions, `net`, `apiUrl`, `keyId`, `secretHint`, `checkoutUrl`, `webhookUrl`, `serverTime`. Never the secret |
| `POST /api/invoices/{invoiceId}/checkout-link` | `createCheckoutLink` | Signed payment-widget link: `{ branding?, locale?, expiresInSeconds? }` → `{ url, token, expiresAt }` |
| `GET /api/request-log` | `listRequestLog` | Requests to the platform, newest first; filters `operationId`, `callId`, `status`; pages |
| `GET /api/request-log/{entryId}` | `getRequestLogEntry` | One request with headers and bodies |
| `DELETE /api/request-log` | `clearRequestLog` | Clear the log |
| `GET /api/stream` | `streamEvents` | SSE: `ready`, `request`, `webhook` |
| `GET /api/received-webhooks` | `listReceivedWebhooks` | Webhooks that reached the receiver; filters `invoiceId`, `webhookId`, `event`, `result`; pages |
| `GET /api/received-webhooks/{receivedId}` | `getReceivedWebhook` | One webhook: headers, raw body, verification, our answer |
| `DELETE /api/received-webhooks` | `clearReceivedWebhooks` | Clear the log (and the duplicate memory) |
| `GET /api/receiver` | `getReceiverSettings` | How the receiver answers |
| `PUT /api/receiver` | `setReceiverSettings` | `{ mode: auto/fixed, status, delayMs, failNext }` — to produce retries, `failed` deliveries and redeliveries on purpose |
| `POST /webhooks/psp` | `receivePspWebhook` | The receiver; called by the platform (`x-caller: platform`) |

Example routes never call the platform and never write request-log entries.

## Passthrough rules

**Request — the backend forwards, it does not validate.** Platform validation errors (`invalid_schema`,
`amount_out_of_range`, …) must reach the UI as the platform produced them, so a backend:

- puts the path ids into the Merchant API path, percent-encoded as one segment;
- forwards **every** query parameter, known or not; plain forwards the query string byte for byte (it is what gets
  signed), sdk passes the parameters to the SDK method, which rebuilds the same string;
- forwards the JSON body: plain the received bytes, sdk the parsed value (re-serialised by the SDK); no body in — no
  body out;
- forwards `X-Client-Request-Id` when the UI sends it.

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

**Attempts.** plain makes exactly one attempt per call. sdk uses the SDK's retry policy (gateway docs 13.10): one call
may produce several attempts, each one its own log entry with `attempt` 1, 2, …; the UI gets the outcome of the last.

## Errors

Every error body has the platform's shape `{ errorCode, errorMessage, details }`.

| Source | How the UI tells | Status and body |
|---|---|---|
| The platform | `errorCode` without the `example_` prefix; `X-Request-Id` present | Exactly as the platform sent it — every `errorCode` with its `details`, including `401 api_auth_failed` (with `details.stringToSign` at `bad_signature`), `429`, `503 maintenance` with `Retry-After` |
| The backend | `errorCode` starts with `example_` | One of the codes below |

| `errorCode` | Status | When | `details` |
|---|---|---|---|
| `example_invalid_request` | 400 | Refused before any platform call (see above); bad widget-link options; bad receiver settings or log filters | `{ field, message }` |
| `example_not_found` | 404 | Unknown route, request-log entry or received webhook | `null` |
| `example_upstream_timeout` | 504 | No answer from the platform in time | `{ timeoutMs }` |
| `example_upstream_unreachable` | 502 | No connection, DNS or TLS failure | `{ cause }` |
| `example_upstream_bad_response` | 502 | An answer that is not the platform's: a redirect, a non-JSON error body, an empty 2xx body | `{ status, requestId, bodyPreview }` |
| `example_internal_error` | 500 | A bug in the backend | `null` |

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

| Field | plain | sdk |
|---|---|---|
| `id`, `callId`, `createdAt`, `durationMs` | yes | yes |
| `operationId` — Merchant API operationId | yes | yes |
| `sdkMethod` — e.g. `invoices.create` | `null` | yes |
| `attempt` | always `1` | 1, 2, … |
| `method`, `path` (with the query, as signed) | yes | yes |
| `status`, `errorCode`, `requestId`, `clientRequestId`, `apiKeyDeprecatedUntil` | yes | yes |
| `transportError` `{ code: timeout/network, message }` when there was no answer | yes | yes |

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
`locale` (`ru`/`en`), `expiresInSeconds` (1–604800, default 86400). Options the SDK rejects are
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

It must be regenerated whenever the copy changes; the workspace tooling (being set up) gets a `contract:sync` that
writes it and a `contract:check` that fails when the sha256 differs. One deliberate deviation in the contract itself:
the copy declares the `V1Statement` object for `text/csv` too; the contract declares a string.

## Coverage

Two mechanical checks, run in CI once the workspace exists:

1. **Contract** — the `x-merchant-api` values of `openapi.yaml` equal the set of operationIds of
   `packages/node/api/openapi.v1.json` (27 today), each exactly once, and the parameter names of each passthrough route
   equal those of its operation. Every other operation has `x-example-extra: true`.
2. **Backends** — the same test suite runs against each backend with a fake gateway (`packages/node/test/fake-gateway.ts`
   is a start): it calls every contract route, then reads `GET /api/request-log` and asserts that the `operationId`s
   of the entries cover every operationId of the copy, that each passthrough response carries `X-Example-Call-Id`
   matching a `callId`, and that statuses, bodies and the passed-through headers equal what the fake gateway sent.

## What both backends guarantee

- [ ] Every route of `openapi.yaml`, with these paths, methods and shapes.
- [ ] Passthrough: forward without validating (only the pre-checks above); status, body and the four headers unchanged.
- [ ] `X-Example-Call-Id` on every passthrough response; matching `callId` in the request log.
- [ ] Platform errors unchanged; own errors only with `example_*` codes and the platform's error shape.
- [ ] One request-log entry per attempt, with the fields above; SSE `request` for each, SSE `webhook` for each received
      webhook.
- [ ] The receiver: raw-body verification, the SDK's reason codes and statuses, duplicates, `ReceiverSettings`.
- [ ] Widget links by gateway docs 20.2–20.3 with the SDK's option rules.
- [ ] Never expose the secret: not in `/api/config` (only `secretHint`), not in the logs, not in errors.
- [ ] Refuse to start with a `psp_pk_live_` key.

## Not in the contract

Dropped from merchant-test-ui on purpose: profiles of several merchants and their CRUD, its login and session, the
secret reveal, per-profile hook tokens (`/hooks/:token` → one `/webhooks/psp`), the raw signed-request console
(`POST …/call`) and replay from the log, fetching the gateway OpenAPI, and the request `source` (ui/console/poll/replay).
Dropped from the earlier `examples/api`: its own error shape `{ statusCode, error, message }`, mapping platform `401` to
`502`, and `listAll` routes (SDK paginators; the UI pages with `page`/`limit`).
