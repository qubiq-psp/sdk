// Shapes of the contract (examples/contract/openapi.yaml), taken from its generated types: the backend and the UI
// cannot drift apart without a type error.
import type { components } from '@psp-examples/contract/types';

type Schemas = components['schemas'];

export type ConfigView = Schemas['Config'];
export type RequestLogItem = Schemas['RequestLogItem'];
export type RequestLogEntry = Schemas['RequestLogEntry'];
export type RequestLogPage = Schemas['RequestLogPage'];
export type ReceivedWebhookItem = Schemas['ReceivedWebhookItem'];
export type ReceivedWebhook = Schemas['ReceivedWebhook'];
export type ReceivedWebhookPage = Schemas['ReceivedWebhookPage'];
export type ReceiverSettings = Schemas['ReceiverSettings'];
export type ExampleError = Schemas['ExampleError'];
export type ExampleErrorCode = Schemas['ExampleErrorCode'];
export type CheckoutLinkView = Schemas['CheckoutLink'];
