// Example plumbing (not needed in a merchant backend): which contract call an SDK request belongs to.
//
// The SDK sends its HTTP attempts through the `fetch` we give it (see request-log/recording-fetch.ts). That fetch
// learns the call it serves — the call id, the operation, the SDK method — from this request-scoped context, which
// CallContextInterceptor sets around every passthrough route handler.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestLogEntry } from './request-log/request-log.types';

/** The last answer the platform gave in this call: the CSV statement takes its status and headers from here. */
export interface CapturedResponse {
  status: number;
  headers: Headers;
}

export interface ApiCall {
  /** `X-Example-Call-Id` of the contract response; `callId` of every request-log entry of the call. */
  readonly callId: string;
  readonly source: 'ui' | 'poll';
  /** Merchant API operationId, e.g. `createInvoice`. */
  readonly operationId: string;
  /** The SDK method the route calls, e.g. `invoices.create`. */
  readonly sdkMethod: string;
  /** The log entry of each attempt, by attempt number (1, 2, …). */
  readonly attempts: Map<number, RequestLogEntry>;
  lastResponse: CapturedResponse | null;
}

const storage = new AsyncLocalStorage<ApiCall>();

export const callContext = {
  run<T>(call: ApiCall, fn: () => T): T {
    return storage.run(call, fn);
  },
  /** The call of the current request, or `undefined` outside a passthrough route. */
  current(): ApiCall | undefined {
    return storage.getStore();
  },
};
