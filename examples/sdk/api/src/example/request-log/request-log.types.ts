// Shapes of the request log, taken from the contract (examples/contract/openapi.yaml).
import type { components } from '@psp-examples/contract/types';

export type RequestLogItem = components['schemas']['RequestLogItem'];
export type RequestLogEntry = components['schemas']['RequestLogEntry'];
export type RequestLogPage = components['schemas']['RequestLogPage'];
