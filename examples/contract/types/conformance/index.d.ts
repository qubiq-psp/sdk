export { FORWARD_CASES } from './cases.js';
export { openSse, request } from './http.js';
export type { Answer, CallInit, SseEvent, SseStream } from './http.js';
/** The environment a backend gets from the suite. Pass it to the backend as its process environment. */
export interface ConformanceEnv extends Record<string, string> {
    PSP_API_URL: string;
    PSP_API_KEY: string;
    PSP_API_SECRET: string;
    PSP_API_PREVIOUS_SECRET: string;
    PSP_CHECKOUT_URL: string;
    APP_PUBLIC_URL: string;
    APP_TESTNET_ONLY: string;
    APP_UPSTREAM_TIMEOUT_MS: string;
}
export interface StartedBackend {
    /** Where the backend listens, e.g. `http://127.0.0.1:41235`. */
    baseUrl: string;
    stop(): Promise<void>;
}
export type StartBackend = (env: ConformanceEnv) => Promise<StartedBackend>;
export interface ConformanceOptions {
    /** Which backend this is: `/api/config` must say the same, and the per-backend rules depend on it. */
    name: 'plain' | 'sdk';
    start: StartBackend;
    /** Timeout of one test, ms. Default 20 000. */
    testTimeoutMs?: number;
}
/** The receiver reads at most this much of a body (the platform's largest webhook); a larger one is `413`. */
export declare const WEBHOOK_BODY_LIMIT: number;
/** Requests without a valid signature: how many are kept, and how much of their body. */
export declare const UNVERIFIED_LIMIT = 100;
export declare const UNVERIFIED_BODY_BYTES = 512;
export declare const CHECKOUT_URL = "https://pay.conformance.example";
export declare const PUBLIC_URL = "https://backend.conformance.example";
/** The per-attempt platform timeout the suite gives a backend; the timeout test makes the platform slower. */
export declare const UPSTREAM_TIMEOUT_MS = 1500;
/** The environment for a backend against a fake gateway at `gatewayUrl`. */
export declare function conformanceEnv(gatewayUrl: string, overrides?: Partial<ConformanceEnv>): ConformanceEnv;
/**
 * The testnet guard is a start-time behaviour: with `APP_TESTNET_ONLY=true` — and with it unset (empty), the default —
 * and a `psp_pk_live_…` key the backend must refuse to start (`start` rejects). Resolves when it does; throws when
 * the backend started.
 */
export declare function expectStartRefusesLiveKey(start: StartBackend): Promise<void>;
/** Defines the conformance tests of one backend (a `describe` block). Call it at the top of a vitest file. */
export declare function defineConformanceSuite(options: ConformanceOptions): void;
