// Bodies for the MSW handlers, typed by the contract: the Merchant API examples of `merchant-api.v1.json` for the
// passthrough routes, hand-written ones for the example routes.
import type { components } from '@psp-examples/contract/types';
import spec from '@psp-examples/contract/merchant-api.v1.json';
import { routeOf, type Ok, type OpId } from '@/api/client';

type S = components['schemas'];

interface SpecOperation {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, { example?: unknown }> }>;
}

/** The example of the success answer of a passthrough route, from the Merchant API description. */
export function example<O extends OpId>(operationId: O): Ok<O> {
  const merchantApi = routeOf(operationId).merchantApi;
  for (const ops of Object.values(spec.paths as Record<string, Record<string, SpecOperation>>)) {
    for (const op of Object.values(ops)) {
      if (op.operationId !== merchantApi) continue;
      const res = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['202'];
      const body = res?.content?.['application/json']?.example;
      if (body !== undefined) return structuredClone(body) as Ok<O>;
    }
  }
  throw new Error(`no example for ${operationId}`);
}

export const CALL_ID = '7c2d9a10-0000-4000-8000-000000000001';
export const ENTRY_ID = '0b1e2c3d-0000-4000-8000-000000000002';
export const RECEIVED_ID = '5f6a7b8c-0000-4000-8000-000000000003';

export const config: S['Config'] = {
  backend: 'plain',
  version: '0.1.0',
  sdkVersion: null,
  net: 'testnet',
  apiUrl: 'https://api.psp.qubiq.cc',
  keyId: 'psp_pk_test_Ab12Cd34Ef56Gh78Ij90Kl12',
  previousSecretSet: false,
  checkoutUrl: 'https://pay.psp.qubiq.cc',
  webhookUrl: 'https://shop.example/webhooks/psp',
  serverTime: '2026-11-17T12:00:00.000Z',
};

export const requestLogItem: S['RequestLogItem'] = {
  id: ENTRY_ID,
  callId: CALL_ID,
  createdAt: '2026-11-17T12:00:00.000Z',
  source: 'ui',
  operationId: 'createInvoice',
  sdkMethod: null,
  attempt: 1,
  method: 'POST',
  path: '/api/v1/invoices',
  status: 201,
  errorCode: null,
  requestId: 'req-0001',
  clientRequestId: null,
  apiKeyDeprecatedUntil: null,
  durationMs: 42,
  transportError: null,
};

export const requestLogEntry: S['RequestLogEntry'] = {
  ...requestLogItem,
  url: 'https://api.psp.qubiq.cc/api/v1/invoices',
  requestHeaders: { 'X-Api-Key': config.keyId, 'X-Api-Signature': 'v1=00ff' },
  requestBody: '{"externalId":"order-1"}',
  responseHeaders: { 'x-request-id': 'req-0001' },
  responseBody: '{"id":"x"}',
  responseBodyTruncated: false,
  signing: { stringToSign: 'v1\nPOST\n/api/v1/invoices\n1790683170\nnonce\nabc', bodySha256: 'abc' },
};

export const receivedItem: S['ReceivedWebhookItem'] = {
  id: RECEIVED_ID,
  receivedAt: '2026-11-17T12:00:01.000Z',
  webhookId: 'c65065bb-9874-49d4-b44b-4930a167a5c1',
  event: 'invoice.paid',
  attempt: 1,
  invoiceId: '32ddde90-754b-4ef9-b5f6-2fd75726af14',
  externalId: 'order-10530',
  invoiceStatus: 'paid',
  verifyResult: 'ok',
  signedWith: 'current',
  duplicate: false,
  responseStatus: 200,
  responseDelayMs: 0,
};

export const received: S['ReceivedWebhook'] = {
  ...receivedItem,
  remoteIp: null,
  headers: { 'x-webhook-event': 'invoice.paid' },
  body: '{"type":"invoice.paid"}',
  json: { type: 'invoice.paid' },
  verify: {
    result: 'ok',
    message: 'The signature matches the current secret',
    timestamp: 1790683170,
    skewSeconds: 1,
    signatureValid: true,
    expectedSignature: 'v1=00ff',
    bodyBytes: 23,
  },
  responseBody: '{"received":true,"duplicate":false}',
};

export const receiverSettings: S['ReceiverSettings'] = { mode: 'auto', status: 500, delayMs: 0, failNext: 0 };

export const checkoutLink: S['CheckoutLink'] = {
  url: 'https://pay.psp.qubiq.cc/#v1.payload.signature',
  token: 'v1.payload.signature',
  expiresAt: '2026-11-18T12:00:00.000Z',
};

export const STATEMENT_CSV = 'network,asset,opening,closing\ntron,USDT,0,100\n';
