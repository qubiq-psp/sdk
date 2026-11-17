# Example merchant backend on `@qubiq-psp/sdk` (NestJS)

A merchant backend built on [`@qubiq-psp/sdk`](../../../packages/node): every Merchant API method, payment-widget
links and a webhook receiver, in a plain NestJS 11 app. It implements the HTTP contract of
[`examples/contract`](../../contract) for the shared UI (`examples/ui`); [`examples/plain/api`](../../plain) implements
the same contract without the SDK.

It is two things at once:

- **the reference integration** — the controllers under `src/<area>/` show how each SDK method is called and what its
  answer means; copy them;
- **the QA backend** — deployed (testnet only) behind the shared UI, so QA can exercise every merchant feature and see
  every HTTP attempt the SDK made. That part lives in `src/example/` and is not needed in a shop.

One merchant per deployment: the API URL, key and secret come from the environment. There is no login (nginx basic auth
is in front of everything except `POST /webhooks/psp`) and no database: the logs live in memory.

## Layout

| Path                                                              | What                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/app.ts`, `src/app.module.ts`                  | Start-up: reads `.env`, checks the environment, builds the app                                                                         |
| `src/config/`                                                     | The environment and its checks (`loadConfig`), the testnet guard                                                                       |
| `src/psp/psp.module.ts`                                           | **The SDK client as a provider**: one `PspClient`, injected with `@Inject(PspClient)`                                                  |
| `src/account/`, `src/invoices/`, `src/balances/`, `src/deposits/` | One module per area; each controller calls the SDK methods of its area                                                                 |
| `src/payouts/`, `src/networks/`, `src/webhook-settings/`          |                                                                                                                                        |
| `src/checkout/`                                                   | Payment-widget links: `psp.checkout.createUrl()`                                                                                       |
| `src/webhooks/`                                                   | The receiver `POST /webhooks/psp`: `psp.webhook.verify()` over the raw body, duplicates, the received-webhooks log and its settings    |
| `src/example/`                                                    | Example plumbing: the request log and its `fetch` wrapper, the call context, the error mapping of the contract, SSE, `/api/config`     |
| `test/`                                                           | vitest: config and guards, every route against a local stub of the platform, the webhook vector of the docs, SSE, widget links, the UI |

## Run it locally

The package lives in the pnpm workspace of this repository and takes `@qubiq-psp/sdk` and `@psp-examples/contract` by
`workspace:*`. The SDK is consumed as a **built** package (`packages/node/dist`), so build it first:

```bash
corepack pnpm install
corepack pnpm --filter @qubiq-psp/sdk build      # or: corepack pnpm -r run build (builds packages/node first)
cd examples/sdk/api
cp .env.example .env                              # the test key pair of your merchant
corepack pnpm dev                                 # tsx watch, http://127.0.0.1:4900
```

`pnpm -r run build` and the root `pnpm run ci` order the packages by their dependencies, so `packages/node` is built
before this package is typechecked, tested and built.

| Script                              | What                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `dev`                               | `tsx watch src/main.ts`                               |
| `build` / `start`                   | `tsc` to `dist/` (CommonJS) / `node dist/main.js`     |
| `typecheck`, `lint`, `format:check` | `tsc`, ESLint 9 (flat, strict type-checked), Prettier |
| `test`                              | vitest, two workers                                   |
| `ci`                                | All of the above; the root `pnpm run ci` runs it      |

To try the receiver from the platform, expose port 4900 with a tunnel, set `APP_PUBLIC_URL` to the tunnel URL and
`PUT /api/webhook` with `webhookUrl` of `GET /api/config`.

**Copying it out of this repository:** replace `workspace:*` with the published range (`"@qubiq-psp/sdk": "^0.3.0"`),
and drop `@psp-examples/contract` together with `src/example/` — or keep the types inline.

## Environment

Checked once at start; a missing or malformed variable stops the start with a message that names the variable and the
rule, never the value.

| Variable                  | Default             | What                                                                                                       |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PSP_API_URL`             | required            | Merchant API base URL, `https://` (`http://` only on localhost), e.g. `https://api.psp.qubiq.cc`           |
| `PSP_API_KEY`             | required            | `psp_pk_test_…`                                                                                            |
| `PSP_API_SECRET`          | required            | `psp_sk_test_…` of the same key. Never sent, logged or returned                                            |
| `PSP_API_PREVIOUS_SECRET` | —                   | The previous secret during a rotation: the receiver also accepts webhooks signed with it                   |
| `PSP_CHECKOUT_URL`        | required            | The payment page of widget links, e.g. `https://pay.psp.qubiq.cc`                                          |
| `APP_PUBLIC_URL`          | —                   | Public URL of the deployment; `webhookUrl` of `/api/config` is `${APP_PUBLIC_URL}/webhooks/psp`.           |
| `APP_TESTNET_ONLY`        | `false`             | `true` — refuse to start with a `psp_pk_live_…` key or a `psp_sk_live_…` secret. Set on every deployment   |
| `HOST`, `PORT`            | `127.0.0.1`, `4900` | Where to listen                                                                                            |
| `APP_UI_DIR`              | —                   | A built `examples/ui` to serve, with an SPA fallback for GETs outside `/api` and `/webhooks`               |
| `APP_LOG_LIMIT`           | `1000`              | Request-log entries and received webhooks kept in memory                                                   |
| `APP_UPSTREAM_TIMEOUT_MS` | `180000`            | Timeout of one attempt to the platform, ms (`timeoutMs` of the SDK; `payouts.create` waits at least 180 s) |
| `LOG_LEVEL`               | `log`               | `error`, `warn`, `log`, `debug` (one line per SDK attempt), `verbose`                                      |

The `PSP_*` names are the ones the SDK reads by itself; here they are checked first and passed explicitly.

## How each area uses the SDK

Every passthrough route calls one SDK method — the `sdkMethod` of the route in
[`routes.json`](../../contract/src/routes.json) — and answers with the platform's status, body and headers. Bodies and
query parameters go to the SDK as received: the platform validates them, and its errors reach the UI unchanged.

| Area                    | Routes                                                                                                        | SDK                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Account                 | `GET /api/account`                                                                                            | `psp.account.get()` — the key, the secret, the IP allowlist and the clock in one cheap call                        |
| Invoices                | `POST/GET /api/invoices`, `GET /api/invoices/{id}`, `…/events`, `…/cancel`                                    | `psp.invoices.create/list/get/listEvents/cancel`; `create` is idempotent by `externalId` (`201` new, `200` repeat) |
| Payment widget          | `POST /api/invoices/{id}/checkout-link`                                                                       | `psp.checkout.createUrl(id, { branding, locale, expiresInSeconds })` — offline, no API call                        |
| Balances and operations | `GET /api/balances`, `/api/operations`, `…/summary`, `…/statement`, `…/{id}`                                  | `psp.balances.get`, `psp.operations.list/getSummary/getStatement/get`; `format=csv` returns a string               |
| Deposits                | `GET /api/deposits`, `/api/deposits/{id}`                                                                     | `psp.deposits.list/get`                                                                                            |
| Payouts                 | `POST /api/payouts/quote`, `POST/GET /api/payouts`, `GET …/{id}`, `POST …/{id}/cancel`                        | `psp.payouts.quote/create/list/get/cancel`; `create` waits up to 180 s and is idempotent by `externalId`           |
| Networks and tariff     | `GET /api/networks`, `/api/tariff`                                                                            | `psp.networks.list()`, `psp.tariff.get()`                                                                          |
| Webhook settings        | `GET/PUT/DELETE /api/webhook`, `POST …/test`, `GET …/deliveries`, `GET …/deliveries/{id}`, `POST …/redeliver` | `psp.webhook.get/setUrl/removeUrl/sendTest`, `psp.webhook.deliveries.list/get/redeliver`                           |
| Webhook receiver        | `POST /webhooks/psp`                                                                                          | `psp.webhook.verify(rawBody, headers)`; `signWebhook()` for the expected signature in the log                      |

The status of a success comes from `getResponseMeta(result).status` (`201`/`200`/`202`) and the passed-through headers
(`X-Request-Id`, `X-Client-Request-Id`, `X-Api-Key-Deprecated`) from `getResponseMeta(result).headers`. The CSV
statement is a string, for which `getResponseMeta()` has nothing: its status and headers come from the `fetch` wrapper's
capture of the last attempt. `X-Client-Request-Id` of the UI goes to the SDK as `RequestOptions.clientRequestId`.

### Webhook receiver

`POST /webhooks/psp` gets the body as raw bytes (`express.raw()` on that path, nothing parses it before) and calls
`psp.webhook.verify(rawBody, req.headers)`: the signature over `{timestamp}.{body}` in constant time, the ±300 s window,
the body against the headers, the network of the key — with `PSP_API_SECRET` and, during a rotation,
`PSP_API_PREVIOUS_SECRET`. A `WebhookVerificationError` gives the reason and the status (`401` signature, `400` body).
A valid webhook whose id was already accepted with `2xx` is a duplicate: answered `200`, not processed again. A shop
stores the event and processes it after answering; this example logs it.

For QA the receiver also records every request (headers, raw body, verification details, the answer) in the
received-webhooks log, sends it over SSE, and can be told to answer with a fixed status, a delay or a number of
failures (`PUT /api/receiver`) to produce retries, `failed` deliveries and redeliveries on purpose.

## Retries and timeouts

The client keeps the SDK defaults (gateway docs 13.10): 180 s per attempt (`APP_UPSTREAM_TIMEOUT_MS`; `payouts.create` always at least 180 s),
up to 4 retries after 1, 2, 4, 8 s (±20 %), `Retry-After` honoured up to 30 s. Reads, `invoices.create`,
`payouts.create`, the cancels and `webhook.setUrl/removeUrl` are retried after a connection error, a timeout or a
retryable answer (`503`, `429`, `500 internal_error` once…); `redeliver` at most once; `sendTest` and `payouts.quote`
only when the request surely did not run. Every attempt is signed anew; the body bytes and `externalId` stay the same.

So one UI action may take minutes on repeated `503`/`429`/timeouts, and produce several request-log entries
(`attempt` 1, 2, …) that appear over SSE as they happen; the UI gets the outcome of the last attempt. nginx
`proxy_read_timeout` on `/api/` must be longer than that, and `/api/stream` needs `proxy_buffering off`.

## Errors

| What the SDK throws                                                    | Answer                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PspApiError` (`PspAuthError` included)                                | The platform's status, `{ errorCode, errorMessage, details }` and headers, unchanged — also `401 api_auth_failed` |
| `PspTimeoutError`                                                      | `504 example_upstream_timeout`, `details: { timeoutMs }`                                                          |
| `PspConnectionError`                                                   | `502 example_upstream_unreachable`, `details: { cause }`                                                          |
| `PspUnexpectedResponseError`                                           | `502 example_upstream_bad_response`, `details: { status, requestId, bodyPreview }`                                |
| `TypeError` of an SDK method (bad `X-Client-Request-Id`, path id `..`) | `400 example_invalid_request`, no platform call                                                                   |

A body that is not JSON is `400 example_invalid_request` too; an unknown route `404 example_not_found`. Every
passthrough answer carries `X-Example-Call-Id`.

## The request log

The SDK takes a `fetch` option. `src/example/request-log/request-log.service.ts` gives it a wrapper of the global
`fetch` that records each HTTP attempt — the URL, the request headers with the signature headers, the body bytes, the
answer's status, headers and body (cut to 256 KB) — and writes one entry when the attempt ends, with or without an
answer. Which contract call, operation and SDK method the attempt belongs to comes from a request-scoped context
(`AsyncLocalStorage`) that `@MerchantApiCall('<operationId>')` sets around the handler. At `401 api_auth_failed` the
entry's `signing` is filled from `PspAuthError.localStringToSign` (the `onRetry` hook for a retried attempt). The API
secret never reaches an entry: the SDK sends only the key and the signature.

`onResponse` and `onRetry` of the SDK go to the Nest logger (`LOG_LEVEL=debug` shows every attempt); `onWarning` reports
a request signed with the previous key and a webhook signed with the previous secret.

## Tests

`corepack pnpm test` (after building the SDK). The backend runs on `127.0.0.1` against a local stub of the platform (a
real HTTP server): every contract route calls its SDK method; statuses, bodies and headers pass through; errors map as
above; retries log one entry per attempt; the CSV statement is byte for byte; SSE; the widget link verifies with the
HMAC of gateway docs 20.2; the receiver verifies the webhook vector of webhook-service docs 13.6 (valid, one byte more
→ `signature_mismatch`, server time `1790684701` → `timestamp_out_of_window`, the previous secret). The shared contract
suite and the fake gateway of `examples/contract` run against `createApp(loadConfig(env))` (in-process) or
`node dist/main.js` (out of process) the same way.
