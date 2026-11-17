# Example UI

One React app for both example backends of the PSP payment platform. QA tests every merchant-facing feature with
it; merchants read it as an example of what a shop's back office does with the Merchant API.

```text
browser ── /api/*, /webhooks/psp ──► examples/plain/api  (signs requests by hand)       ──► Merchant API
  this UI                        or ► examples/sdk/api    (NestJS on @qubiq-psp/sdk)    ──► Merchant API
```

The UI talks to a backend only through the contract of [`examples/contract`](../contract/README.md): the same build
works with either backend, and the header says which one it talks to (`GET /api/config`). One merchant per
deployment: the API key and secret live in the backend's environment, the browser never sees the secret. There is no
login: nginx basic auth stands in front of a deployment.

## Two builds

The two builds differ in one component only, the payment widget. Everything else is the same code.

| Build   | Command            | Output       | The payment widget                                                                                                      |
| ------- | ------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `sdk`   | `pnpm build:sdk`   | `dist/sdk`   | `<PspCheckout>` of [`@qubiq-psp/react`](../../packages/react/README.md)                                                 |
| `plain` | `pnpm build:plain` | `dist/plain` | a plain `<iframe>` with its own `postMessage` handling ([`src/widget/plain-protocol.ts`](src/widget/plain-protocol.ts)) |

`vite.config.ts` points the import `virtual:checkout-frame` at
[`checkout-frame.sdk.tsx`](src/widget/checkout-frame.sdk.tsx) or
[`checkout-frame.plain.tsx`](src/widget/checkout-frame.plain.tsx) by the Vite mode. Both accept a message only from
`checkoutUrl` of `/api/config` and only from their own frame, and both show the page's events (`ready`, `status`,
`resize`, `error`, and once per link `paid` and `expired`). The plain build also lists the messages it rejected.

The plain bundle has no `@qubiq-psp/*` code, checked twice by `pnpm build`:

- the Vite build looks at the module graph: `plain` fails on any module of `@qubiq-psp/*` or `packages/*`; `sdk` fails
  without `@qubiq-psp/react`;
- `pnpm check:bundles` greps the built files for markers of the SDK's code, with `dist/sdk` as the positive control.

`pnpm build` makes both, then runs the check.

## Run against a backend

Node.js 22, from the repository root: `pnpm install`.

```bash
pnpm --filter @qubiq-psp/react build                  # the sdk widget is the built package
cd examples/ui
VITE_BACKEND_URL=http://127.0.0.1:4600 pnpm dev        # plain backend; 4900 for sdk
pnpm dev:plain                                         # the same with the plain widget
```

Vite serves the UI on `http://127.0.0.1:5177` and proxies `/api` and `/webhooks` to `VITE_BACKEND_URL` (default
`http://127.0.0.1:4600`); the SSE stream `/api/stream` goes through unbuffered. Settings can also go into `.env.local`
(see [`.env.example`](.env.example)).

A deployment serves `dist/sdk` or `dist/plain` as static files behind nginx on the same origin as the backend:
`/api/*` and `/webhooks/*` go to the backend (`proxy_buffering off` for `/api/stream`, a `proxy_read_timeout` longer
than 180 s for `/api/`), and `frame-src` of the page's CSP allows the payment page origin.

## Screens

Every screen shows how its calls went: the status, `X-Request-Id`, and a link to the request-log entries of that call
(by `X-Example-Call-Id`). Every error shows its `errorCode`, the message and `details` as they came, and whether the
platform or the example backend produced it (`example_*` codes).

| Screen              | What it does                                                                                                                                                                                       | Contract routes                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Account             | The merchant, its status, capabilities and key status (`current`/`previous`, `X-Api-Key-Deprecated`), the clock skew; the deployment: backend, net, key, URLs                                      | `GET /api/account`, `GET /api/config`                                                                                                           |
| Invoices            | The list with filters (status, external id, network and asset, dates) and pages, auto-refresh on demand                                                                                            | `GET /api/invoices`                                                                                                                             |
| New invoice         | Network and asset from the networks, amount limits from the tariff; Create, Repeat (the same `externalId` → `200` and the same invoice), Conflict (another amount → `409 invoice_conflict`)        | `POST /api/invoices`, `GET /api/networks`, `GET /api/tariff`                                                                                    |
| Invoice             | Address and QR code, amounts, payments, the history with pages, cancel (asks first), the webhooks received for it and its platform deliveries; refreshes every 5 s until final                     | `GET /api/invoices/{id}`, `GET …/events`, `POST …/cancel`, `GET /api/received-webhooks`, `GET /api/webhook/deliveries`                          |
| Payment widget      | On the invoice: branding, language and lifetime of the link, the page in a frame and the log of its events                                                                                         | `POST /api/invoices/{id}/checkout-link`                                                                                                         |
| Balances            | Per network and asset and per currency                                                                                                                                                             | `GET /api/balances`                                                                                                                             |
| Operations          | The list with filters and pages; the summary and the statement of a period, the statement also as a CSV download; one operation                                                                    | `GET /api/operations`, `GET /api/operations/summary`, `GET /api/operations/statement` (`format=json`, `format=csv`), `GET /api/operations/{id}` |
| Deposits            | The list with filters, pages and totals; one deposit                                                                                                                                               | `GET /api/deposits`, `GET /api/deposits/{id}`                                                                                                   |
| Payouts             | The list with filters and pages; a quote, then the payout with an `externalId` (asks first; Repeat → `200`); one payout, cancel (asks first)                                                       | `GET /api/payouts`, `POST /api/payouts/quote`, `POST /api/payouts`, `GET /api/payouts/{id}`, `POST …/cancel`                                    |
| Networks and tariff | Networks with their assets and limits, the tariff rules                                                                                                                                            | `GET /api/networks`, `GET /api/tariff`                                                                                                          |
| Webhook settings    | The settings; set the URL (prefilled with this backend's receiver) or remove it (asks first); a test webhook; the platform's deliveries with filters                                               | `GET`/`PUT`/`DELETE /api/webhook`, `POST /api/webhook/test`, `GET /api/webhook/deliveries`                                                      |
| Delivery            | Status, attempts with headers and answers, the body; send again; what this backend's receiver got of it                                                                                            | `GET /api/webhook/deliveries/{id}`, `POST …/redeliver`, `GET /api/received-webhooks`                                                            |
| Received webhooks   | What reached `POST /webhooks/psp`: verified or not and why, which secret, duplicate, our answer; how the receiver answers (`auto`/`fixed`, status, fail next N, delay); clear the log; one webhook | `GET`/`DELETE /api/received-webhooks`, `GET /api/received-webhooks/{id}`, `GET`/`PUT /api/receiver`                                             |
| Request log         | Every request to the Merchant API: filters by operation, source, status and call; live over SSE; one entry with headers, bodies and the string to sign (plain) or the SDK method (sdk); clear      | `GET`/`DELETE /api/request-log`, `GET /api/request-log/{id}`, `GET /api/stream`                                                                 |

Calls the UI makes by itself — auto-refresh, the refetch after a webhook arrives — send `X-Example-Source: poll`; the
request log hides them unless asked. The first load of a screen and the Refresh buttons are `ui`.

## Test scenarios

1. **Connection.** Account: `active`, the key `current`, the clock in sync.
2. **Webhooks.** Webhook settings → Set URL (this backend's receiver) → `200` or `202` → Send test → Received
   webhooks shows `webhook.test`, verified.
3. **Invoice.** New invoice → Create (`201`) → Repeat (`200`, the same invoice) → Conflict (`409 invoice_conflict`).
   Pay it in testnet and watch the status, the history and `invoice.paid` arrive.
4. **Widget.** On the invoice → Payment widget → Create link: the frame shows the page with the branding, the log has
   `ready` and `resize`. A lifetime of 1 minute → after a minute the log has `error` `link_expired`.
5. **Retries.** Received webhooks → fail next 3 → pay or send a test → the delivery shows failed attempts, then
   succeeds; Send again on a delivered one → the receiver reports a duplicate.
6. **Payout.** New payout → Get quote → Create payout → confirm; Repeat → `200`, the same payout.
7. **Errors.** Any platform error shows its `errorCode` and `details`; `401 api_auth_failed` also shows the platform's
   string to sign, to compare with the request log (plain).

## Development

| Script                               | What it does                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm dev`, `pnpm dev:plain`         | The dev server with the sdk or the plain widget                                 |
| `pnpm build`                         | Both builds, then `check:bundles`                                               |
| `pnpm build:sdk`, `pnpm build:plain` | One build                                                                       |
| `pnpm typecheck`, `pnpm lint`        | `tsc`, ESLint 9                                                                 |
| `pnpm format:check`                  | Prettier                                                                        |
| `pnpm test`                          | Vitest with Testing Library and MSW                                             |
| `pnpm ci`                            | All of the above, after building `@qubiq-psp/react`; the root `pnpm ci` runs it |

The tests use MSW handlers typed by the contract (`test/msw.ts`), with the Merchant API examples of
`merchant-api.v1.json` as bodies:

- `src/api/client.test.ts` — paths, methods, query strings, `X-Example-Source`, `X-Client-Request-Id`,
  `X-Example-Call-Id`, error parsing (platform, backend, no answer), the CSV statement;
- `src/widget/*.test.tsx` — the plain widget's origin and window checks, events and resize; the sdk widget's mapping
  of `<PspCheckout>` callbacks;
- `test/screens.test.tsx` — every screen renders and does its actions, and the last test fails when any route of the
  contract (except the receiver, which the platform calls) was not called by a screen.

Copying this example outside the workspace: replace `workspace:*` of `@qubiq-psp/react` with the published range, and
generate the contract types from `examples/contract/openapi.yaml` yourself.
