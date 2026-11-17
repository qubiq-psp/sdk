// The shared conformance suite of examples/contract against this backend and the fake gateway.
import { describe, it } from 'vitest';
import {
  defineConformanceSuite,
  expectStartRefusesLiveKey,
  type ConformanceEnv,
} from '@psp-examples/contract/conformance';
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/app-config';

/** Builds the app from the suite's env (not process.env) and listens on a free port; a live key rejects. */
async function start(env: ConformanceEnv): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const app = await createApp(loadConfig(env), { logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, stop: () => app.close() };
}

defineConformanceSuite({ name: 'sdk', start });

describe('testnet guard', () => {
  it('refuses to start with a psp_pk_live_ key', () => expectStartRefusesLiveKey(start));
});
