# examples/plain/api — a PSP merchant backend without an SDK

An example merchant backend of the PSP payment platform written against the HTTP API directly: it **signs Merchant API
requests, builds payment-widget links and verifies webhooks itself**, with nothing but `node:crypto` and `fetch`. Use it
to see what [`@qubiq-psp/sdk`](../../../packages/node) does for you, or as a reference when your backend is not in
Node.js.

It implements the HTTP contract of [`examples/contract`](../../contract/README.md), which the shared UI
(`examples/ui`) talks to; the same UI works with the SDK-based backend `examples/sdk/api`. It is deployed for QA on the
testnet only.

## The parts to copy

These files depend on `node:crypto` only and carry the spec in their comments. Copy them into your backend:

| File                                             | What it does                                                                                                                                                                                              | Spec                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [`src/signer.ts`](src/signer.ts)                 | The string to sign `v1\nMETHOD\nTARGET\nts\nnonce\nsha256(body)`, the HMAC, the four `X-Api-*` headers, and `resolveTarget()`: sign exactly the path and query that `fetch` sends                         | gateway docs 13.2–13.5         |
| [`src/platform.ts`](src/platform.ts)             | One signed attempt with `fetch`: build the URL once, sign it, send the same bytes, read the answer; timeouts and connection errors are reported, redirects are not followed                               | gateway docs 13.2, 13.10       |
| [`src/webhook-verify.ts`](src/webhook-verify.ts) | `X-Webhook-Timestamp + "." + raw body`, the ±300 s window, constant-time comparison, the previous secret during a rotation, then the body checks; returns the first failed step with the status to answer | webhook-service docs 13.6–13.7 |
| [`src/checkout.ts`](src/checkout.ts)             | The widget link `{checkoutUrl}/#v1.<payload>.<signature>` signed offline, with the option rules of `psp.checkout.createUrl()`                                                                             | gateway docs 20.2–20.4         |

The tests check them on the published vectors: [`test/signer.test.ts`](test/signer.test.ts) (vectors 1 and 2 of 13.5
and its negative rows), [`test/webhook-verify.test.ts`](test/webhook-verify.test.ts) (the 13.6 example and the 13.7
table), [`test/checkout.test.ts`](test/checkout.test.ts) (the 20.4 vectors).

Everything else is the plumbing of the contract: [`src/passthrough.ts`](src/passthrough.ts) (the 27 routes
`/api/<path>` → `/api/v1/<path>`, generated from the contract's `routes.json`), [`src/request-log.ts`](src/request-log.ts),
[`src/receiver.ts`](src/receiver.ts) (`POST /webhooks/psp`, its log and test behaviour), [`src/stream.ts`](src/stream.ts)
(SSE), [`src/config.ts`](src/config.ts), [`src/app.ts`](src/app.ts), [`src/main.ts`](src/main.ts).

### How signing works

1. Build the URL once: `new URL('/api/v1/invoices?status=active,paid', PSP_API_URL)`. TARGET is `url.pathname +
url.search` — what goes into the HTTP request line. The WHATWG URL encodes Cyrillic and spaces but keeps commas;
   `URLSearchParams` would encode the comma (`%2C`), which is another string and another signature.
2. Serialise the body once and keep the bytes. Sign `sha256` of exactly those bytes (an empty body is the hash of the
   empty string; `{}` is not empty).
3. `X-Api-Timestamp` (Unix seconds, 10 digits) and `X-Api-Nonce` (a fresh UUID v4) are new for every attempt.
4. `X-Api-Signature: v1=` + hex HMAC-SHA256 with the UTF-8 bytes of the secret as the key.
5. Send the same URL and body bytes. On `401 api_auth_failed` with `details.reason: bad_signature`, compare your string
   to sign with `details.stringToSign` of the answer: different strings — the TARGET or the body changed; equal strings
   — the secret is wrong. The request log of this backend keeps the string it signed for that comparison.

### How webhook verification works

1. Read the body as raw bytes, before any JSON parser (`receiver.ts` replaces Fastify's body parsers on its route).
2. `verifyWebhook()` checks the headers, the time window, the signature format and the HMAC with the current secret
   and, during a rotation, the previous one — compared in constant time.
3. Only then the JSON: `id`/`type` equal to `X-Webhook-Id`/`X-Webhook-Event`, `version: 1`, and `chain` of the right
   network (a testnet secret refuses `mainnet` webhooks).
4. Answer `401` to signature problems and `chain_mismatch`, `400` to body problems — any non-2xx makes the platform
   retry. Answer `2xx` to a valid webhook and to a duplicate by `X-Webhook-Id`. Store first, process after answering.

## Run locally

Node.js 22 (it runs the TypeScript sources directly), pnpm through corepack:

```bash
corepack pnpm install                     # at the repository root
cd examples/plain/api
cp .env.example .env                      # fill in your test key and secret
corepack pnpm dev                         # http://127.0.0.1:4600, restarts on changes
curl -s http://127.0.0.1:4600/api/config
```

`pnpm build` compiles to `dist/`, `pnpm start` runs `dist/main.js`. To get webhooks on a local machine, put a tunnel in
front of the port and set `APP_PUBLIC_URL` to its https origin; then `PUT /api/webhook` with `{ "url": webhookUrl }`.

Outside this repository replace `"@psp-examples/contract": "workspace:*"` with a copy of the contract (it provides the
types and `routes.json`).

| Script                              | What it does                                                   |
| ----------------------------------- | -------------------------------------------------------------- |
| `dev`                               | `node --watch` of `src/main.ts` with `.env`                    |
| `start`                             | `dist/main.js` with `.env` if present                          |
| `build`                             | `tsc` to `dist/`                                               |
| `typecheck`, `lint`, `format:check` | tsc, eslint 9, prettier                                        |
| `test`                              | vitest: the vectors, config, the routes, the conformance suite |
| `ci`                                | all of the above; the repository's `pnpm run ci` runs it       |

## Environment

All variables are checked at start; a wrong one stops the process with a message naming it (never the value of a
credential). Empty means unset.

| Variable                  | Required | Default             | What                                                                                                                                  |
| ------------------------- | -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PSP_API_URL`             | yes      |                     | Merchant API origin, e.g. `https://api.psp.qubiq.cc`. https; plain http only for `localhost`/`127.0.0.1`                              |
| `PSP_API_KEY`             | yes      |                     | `psp_pk_test_…` (24 characters after the prefix)                                                                                      |
| `PSP_API_SECRET`          | yes      |                     | `psp_sk_test_…` (36 characters); of the same network as the key                                                                       |
| `PSP_API_PREVIOUS_SECRET` | no       |                     | The previous secret during a rotation: webhooks signed with it are accepted (`signedWith: previous`)                                  |
| `PSP_CHECKOUT_URL`        | yes      |                     | Origin of the payment page, e.g. `https://pay.psp.qubiq.cc`                                                                           |
| `APP_PUBLIC_URL`          | no       |                     | Public origin of this deployment; the webhook URL is `{APP_PUBLIC_URL}/webhooks/psp` (`webhookUrl` of `/api/config`)                  |
| `APP_TESTNET_ONLY`        | no       | `false`             | `true` — refuse to start with a `psp_pk_live_…` key or a `psp_sk_live_…` secret. Every deployment sets it                             |
| `APP_UPSTREAM_TIMEOUT_MS` | no       | `180000`            | Timeout of one platform attempt. The platform answers within 180 s; a shorter one turns a slow `createPayout` into an unknown outcome |
| `HOST`, `PORT`            | no       | `127.0.0.1`, `4600` | Where to listen (behind nginx)                                                                                                        |
| `APP_UI_DIR`              | no       |                     | A built `examples/ui` to serve, with `index.html` for every other GET outside `/api` and `/webhooks`                                  |
| `APP_LOG_LIMIT`           | no       | `1000`              | Request-log entries and received webhooks kept in memory, each                                                                        |
| `LOG_LEVEL`               | no       | `info`              | `fatal`…`trace`, `silent`                                                                                                             |

A key and a secret of different networks are refused whatever `APP_TESTNET_ONLY` says.

## Security model of the deployment

- **One merchant per deployment, from the environment.** The API URL, key and secret are never taken from a request,
  so the backend cannot be pointed at another host (merchant-test-ui finding MTU-002). The secret only keys HMACs: it is
  never sent, logged, returned by `/api/config` or written into the request log.
- **No login of its own.** nginx basic auth protects everything except `POST /webhooks/psp`, which the platform calls
  and which is protected by the signature. merchant-test-ui's own login (and its bypass, MTU-001) is gone.
- **Testnet only** with `APP_TESTNET_ONLY=true`.
- **Bind to loopback.** `HOST` defaults to `127.0.0.1`; the client IP is trusted from `X-Forwarded-For` of loopback only.

## What it deliberately does not do

- **No retries.** Each UI action is exactly one signed attempt, and the UI shows the platform's answer, errors included.
  A production client retries timeouts, connection errors, `503` and `429` with a new timestamp, nonce and signature
  per attempt and the same body bytes and `externalId` (gateway docs 13.10); `@qubiq-psp/sdk` does that by default and
  the sdk backend shows it.
- **No validation of Merchant API input.** It forwards the query string and body as received so that the platform's own
  validation errors reach the UI. Before sending it only refuses what the SDK refuses: a body that is not JSON, a bad
  `X-Client-Request-Id`, a path id that is empty, `.` or `..` (`400 example_invalid_request`).
- **No persistence.** The request log, the received webhooks and the receiver settings live in memory and reset on a
  restart. A real handler stores the event (and its `id` for deduplication) durably before it answers `2xx`.
- **No calls of its own.** Nothing at start-up and no polling: the platform is called only to serve a UI request.
- No merchant profiles, sessions, raw request console, request replay or fetching of the gateway OpenAPI (all of which
  merchant-test-ui had).
