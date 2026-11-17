// The conformance suite against the reference backend: proves the suite passes for a correct implementation.
import { describe, it } from 'vitest';
import { defineConformanceSuite, expectStartRefusesLiveKey } from '../src/conformance/index.ts';
import { startReferenceBackend } from './reference-backend.ts';

defineConformanceSuite({ name: 'plain', start: startReferenceBackend });

describe('testnet guard', () => {
  it('the reference backend refuses a live key with APP_TESTNET_ONLY=true', async () => {
    await expectStartRefusesLiveKey(startReferenceBackend);
  });
});
