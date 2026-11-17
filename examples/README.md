# Examples

Two example merchant backends of the PSP platform and one UI for both. They show a merchant how to integrate, and
they are what QA uses to exercise every merchant-facing feature of the platform on the testnet.

| Folder                               | What it is                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`plain/api`](plain/api)             | Fastify backend without an SDK: signs Merchant API requests, builds payment-widget links and verifies webhooks by hand (`node:crypto`) |
| [`sdk/api`](sdk/api)                 | NestJS backend on [`@qubiq-psp/sdk`](../packages/node): the same, through the SDK                                                      |
| [`ui`](ui)                           | One React app for both backends; its `sdk` build shows the payment page with [`@qubiq-psp/react`](../packages/react), `plain` without  |
| [`contract`](contract)               | The HTTP contract between the UI and the backends, the fake Merchant API and the conformance suite both backends pass                  |
| `plain/Dockerfile`, `sdk/Dockerfile` | One image per backend, with its build of the UI                                                                                        |

The UI talks to a backend only through [the contract](contract/README.md), so the same UI works with either backend.
A backend serves one merchant: the API URL, key and secret come from its environment, and the secret never reaches the
browser.

## Run locally

Node.js 22 and pnpm (`corepack enable`), at the repository root:

```bash
pnpm install
pnpm --filter @qubiq-psp/sdk --filter @qubiq-psp/react run build   # the workspace packages the sdk backend and UI use
cp examples/plain/api/.env.example examples/plain/api/.env          # then fill in a testnet key and secret
pnpm --filter @psp-examples/plain-api run dev                       # http://127.0.0.1:4600
pnpm --filter @psp-examples/ui run dev:plain                        # http://127.0.0.1:5177, /api goes to the backend
```

The sdk backend is the same with `examples/sdk/api` (port 4900, `VITE_BACKEND_URL=http://127.0.0.1:4900` and
`pnpm --filter @psp-examples/ui run dev` for the UI). Each backend's README lists its environment and describes its
Docker image; the fake Merchant API of `examples/contract` can stand in for the platform in tests.

## Security model

The examples are deployed for QA on the testnet only, behind nginx; the backends rely on that and add their own
limits:

- **Access.** nginx basic auth protects everything except `POST /webhooks/psp`, which the platform calls without
  credentials; the backends have no login of their own. Publish the container ports on loopback only.
- **Testnet only.** A backend refuses to start with a live key or secret unless `APP_TESTNET_ONLY=false` is set
  explicitly (for a local run against mainnet, never in a deployment).
- **Cross-site requests.** Basic auth is sent by the browser with any request, also one made by another site's page,
  so a state-changing `/api` request from another site (`Origin`, `Sec-Fetch-Site`) is `403`, a body must be
  `application/json`, and the UI is served with a CSP that allows only the payment page as a frame and forbids framing
  the UI itself.
- **The open receiver.** `POST /webhooks/psp` reads at most 64 KB. A request whose signature does not verify keeps only
  the first 512 bytes of its body, in a ring of its own of the last 100, so junk cannot push real webhooks out of the
  log. All logs are in memory, bounded by entries (`APP_LOG_LIMIT`) and bytes (`APP_LOG_MAX_BYTES`).
- **No other hosts.** The platform URL, key and secret come only from the environment; no request can point a
  backend at another host or merchant.
- **Accepted: QA can forge webhooks of the deployment's own merchant.** The received-webhooks log shows, for any
  request with a Unix-seconds timestamp, the signature the platform would have sent (`verify.expectedSignature`). A
  logged-in QA user can therefore post a body to the receiver, read its valid signature and send that webhook to any
  receiver that trusts the same secret. This is intended — it is how QA tests webhook handling — and it is limited to
  the one testnet merchant of the deployment. Do not give a deployed example a secret that another receiver relies on.
  The secret is never signed over anything but a Unix-seconds timestamp and a body, so it does not yield other tokens
  of the merchant (such as payment-widget links).
