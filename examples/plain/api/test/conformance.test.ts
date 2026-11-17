// The shared conformance suite of examples/contract: the same checks run against the sdk backend.
import {
  defineConformanceSuite,
  expectStartRefusesLiveKey,
  type ConformanceEnv,
} from '@psp-examples/contract/conformance';
import { describe, it } from 'vitest';
import { createApp } from '../src/app.ts';

/** Builds the backend from the suite's env (never process.env) and listens on a free port of 127.0.0.1. */
async function start(env: ConformanceEnv) {
  const { app } = await createApp(env, { logger: false });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return { baseUrl, stop: () => app.close() };
}

defineConformanceSuite({ name: 'plain', start });

describe('testnet guard', () => {
  it('refuses to start with a psp_pk_live_ key', () => expectStartRefusesLiveKey(start));
});
