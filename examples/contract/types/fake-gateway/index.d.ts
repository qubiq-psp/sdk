export { signApiRequest, signWebhook, verifyCheckoutToken, signCheckoutPayload, sha256Hex, } from '../internal/crypto.js';
export type { CheckoutPayload, CheckoutTokenCheck } from '../internal/crypto.js';
/** The test key (made up). */
export declare const TEST_KEY = "psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp";
/** The made-up secret of the gateway docs (13.5), with the testnet prefix. */
export declare const TEST_SECRET = "psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N";
/** A made-up previous secret, for webhooks signed during a rotation. */
export declare const TEST_PREVIOUS_SECRET = "psp_sk_test_Pr3v10usS3cr3tR0tat10nW1nd0wQxZ7k";
/** A made-up live key and secret: a backend with `APP_TESTNET_ONLY=true` must refuse to start with them. */
export declare const LIVE_KEY = "psp_pk_live_7Hq2Wd5Lx9Mz3Rv8Nc1Bt6Ky";
export declare const LIVE_SECRET = "psp_sk_live_4Fg8Jk2Lm6Np9Qr3St7Vw1Xy5Za0Bc8De2Gh";
/** The invoice of the documentation examples; webhooks built by {@link webhookBody} are about it. */
export declare const TEST_INVOICE_ID = "97da92f5-45c0-411b-9ed5-6793b396cd5f";
/** merchantId of the documentation examples. */
export declare const TEST_MERCHANT_ID = "6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13";
type Json = Record<string, unknown>;
/** A scripted answer. */
export interface Reply {
    status?: number;
    /** JSON body. */
    json?: unknown;
    /** Raw body text (with `contentType`, default `text/plain`). */
    text?: string;
    contentType?: string;
    /** Extra answer headers, e.g. `Retry-After`, `X-Api-Key-Deprecated`. */
    headers?: Record<string, string>;
    /** Wait before answering, ms (to trigger a client timeout). */
    delayMs?: number;
    /** Close the connection without an answer. */
    destroy?: boolean;
}
export interface RecordedRequest {
    /** 1, 2, … in arrival order. */
    seq: number;
    /** The Merchant API operation of the method and path; null — no such route. */
    operationId: string | null;
    method: string;
    /** Path and query exactly as in the request line. */
    target: string;
    path: string;
    /** Decoded query pairs in order. */
    query: [string, string][];
    /** Request headers, names in lower case. */
    headers: Record<string, string>;
    body: string;
    /** The signature check: `ok`, or the `details.reason` of the `401 api_auth_failed` answer. */
    auth: {
        ok: boolean;
        reason: string | null;
        stringToSign: string | null;
    };
    /** The answer; null — none was sent (connection closed, or the client went away first). */
    response: {
        status: number;
        headers: Record<string, string>;
        body: string;
    } | null;
}
export interface InjectOptions {
    /** How many next calls of the operation get this answer: a number (default 1) or `always` until cleared. */
    times?: number | 'always';
}
export interface WebhookOptions {
    /** `X-Webhook-Event` and `type`, default `invoice.paid`. */
    type?: string;
    /** `X-Webhook-Id` and `id`. Default: a new deterministic uuid. */
    id?: string;
    /** The full body; default built by {@link webhookBody}. */
    body?: string;
    /** Overrides of the default body fields (`chain`, `merchantId`, `data`, …). */
    fields?: Json;
    /** Secret that signs; default {@link TEST_SECRET}. */
    secret?: string;
    /** `X-Webhook-Timestamp`, unix seconds; default now. */
    timestamp?: number;
    /** A signature to send instead of the computed one. */
    signature?: string;
    attempt?: number;
    /** Headers to leave out, e.g. `x-webhook-signature`. */
    omitHeaders?: string[];
    /** Headers to set over the computed ones (e.g. a different `X-Webhook-Id`). */
    headers?: Record<string, string>;
}
export interface SentWebhook {
    status: number;
    headers: Headers;
    text: string;
    json: unknown;
    elapsedMs: number;
    /** What was sent. */
    request: {
        headers: Record<string, string>;
        body: string;
    };
}
export interface FakeGateway {
    /** Base URL, e.g. `http://127.0.0.1:41234` — the `PSP_API_URL` of a backend. */
    url: string;
    key: string;
    secret: string;
    requests: RecordedRequest[];
    /** Requests from index `from` on (use `requests.length` as a mark before a call), optionally of one operation. */
    since(from: number, operationId?: string): RecordedRequest[];
    /** The next calls of the operation get `reply` (after a valid signature). */
    inject(operationId: string, reply: Reply | ((req: RecordedRequest) => Reply), options?: InjectOptions): void;
    /**
     * The next call gets a platform error: the documented example of `errorCode` for this operation when there is one,
     * otherwise `{errorCode, errorMessage, details}` with the given status.
     */
    injectError(operationId: string, errorCode: string, options?: {
        status?: number;
        details?: unknown;
        headers?: Record<string, string>;
    } & InjectOptions): void;
    clearInjections(): void;
    /** Forgets requests, injections, invoices and payouts. */
    reset(): void;
    /** Signs and POSTs a webhook to `url`. */
    sendWebhook(url: string, options?: WebhookOptions): Promise<SentWebhook>;
    close(): Promise<void>;
}
/** A deterministic uuid v4-shaped id from a seed. */
export declare function fakeUuid(seed: string): string;
/** Starts the fake gateway on 127.0.0.1 and a free port. */
export declare function startFakeGateway(options?: {
    key?: string;
    secret?: string;
}): Promise<FakeGateway>;
/** The body of a webhook (webhook-service 13.3), version 1, testnet chain `nile`, the documentation merchant. */
export declare function webhookBody(type?: string, id?: string, fields?: Json): string;
/** Signs a webhook like webhook-service and POSTs it. Unless overridden, the headers match the body. */
export declare function sendWebhook(url: string, options?: WebhookOptions): Promise<SentWebhook>;
