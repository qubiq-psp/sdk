import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
import { BASE_ENV, OTHER_SECRET, SHOP_KEY, SHOP_SECRET } from './helpers.ts';

const LIVE_KEY = 'psp_pk_live_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
const LIVE_SECRET = 'psp_sk_live_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const TEST_KEY = 'psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
const TEST_SECRET = 'psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';

const problems = (env: Record<string, string>): string[] => {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
};

describe('loadConfig', () => {
  it('the defaults', () => {
    expect(loadConfig({ ...BASE_ENV, APP_PUBLIC_URL: '' })).toEqual({
      apiUrl: 'http://127.0.0.1:4000',
      apiKey: SHOP_KEY,
      apiSecret: SHOP_SECRET,
      previousApiSecret: null,
      net: 'testnet',
      checkoutUrl: 'https://pay.psp.qubiq.cc',
      publicUrl: null,
      webhookUrl: null,
      testnetOnly: true,
      upstreamTimeoutMs: 180_000,
      host: '127.0.0.1',
      port: 4600,
      uiDir: null,
      logLimit: 1000,
      logMaxBytes: 32 * 1024 * 1024,
      logLevel: 'info',
    });
  });

  it('origins are normalised; the webhook URL comes from APP_PUBLIC_URL', () => {
    const c = loadConfig({
      ...BASE_ENV,
      PSP_API_URL: 'https://api.psp.qubiq.cc/',
      APP_PUBLIC_URL: 'https://plain.example.com/',
      HOST: '0.0.0.0',
      PORT: '8080',
      APP_LOG_LIMIT: '50',
      APP_LOG_MAX_BYTES: '2097152',
      LOG_LEVEL: 'warn',
      PSP_API_PREVIOUS_SECRET: OTHER_SECRET,
    });
    expect(c).toMatchObject({
      apiUrl: 'https://api.psp.qubiq.cc',
      webhookUrl: 'https://plain.example.com/webhooks/psp',
      host: '0.0.0.0',
      port: 8080,
      logLimit: 50,
      logMaxBytes: 2 * 1024 * 1024,
      logLevel: 'warn',
      previousApiSecret: OTHER_SECRET,
    });
  });

  it('lists every problem at once; required variables', () => {
    expect(problems({})).toEqual([
      'PSP_API_URL is required',
      'PSP_API_KEY is required',
      'PSP_API_SECRET is required',
      'PSP_CHECKOUT_URL is required',
    ]);
    expect(problems({ ...BASE_ENV, PORT: '70000', APP_LOG_LIMIT: '0', LOG_LEVEL: 'loud' })).toHaveLength(3);
    expect(problems({ ...BASE_ENV, APP_LOG_MAX_BYTES: '1000' })).toEqual([
      'APP_LOG_MAX_BYTES must be an integer from 1048576 to 1073741824',
    ]);
  });

  it('URLs: https or local http, origins only (the API URL only from the environment — MTU-002)', () => {
    expect(problems({ ...BASE_ENV, PSP_API_URL: 'http://api.psp.qubiq.cc' })[0]).toMatch(/PSP_API_URL must be https/);
    expect(problems({ ...BASE_ENV, PSP_API_URL: 'https://api.psp.qubiq.cc/api/v1' })[0]).toMatch(/origin/);
    expect(problems({ ...BASE_ENV, PSP_API_URL: 'https://user:pw@api.psp.qubiq.cc' })[0]).toMatch(/origin/);
    expect(problems({ ...BASE_ENV, PSP_CHECKOUT_URL: 'https://pay.psp.qubiq.cc/#' })[0]).toMatch(/PSP_CHECKOUT_URL/);
    expect(problems({ ...BASE_ENV, PSP_CHECKOUT_URL: 'ftp://pay' })[0]).toMatch(/PSP_CHECKOUT_URL/);
    expect(problems({ ...BASE_ENV, APP_PUBLIC_URL: 'not a url' })[0]).toMatch(/APP_PUBLIC_URL/);
    expect(problems({ ...BASE_ENV, PSP_API_URL: 'http://localhost:4000' })).toEqual([]);
  });

  it('credentials: the shape is checked and the value never printed', () => {
    const typo = `${SHOP_SECRET} `;
    const found = problems({
      ...BASE_ENV,
      PSP_API_SECRET: typo,
      PSP_API_KEY: 'psp_pk_bad',
      PSP_API_PREVIOUS_SECRET: 'x',
    });
    expect(found).toEqual([
      'PSP_API_KEY must look like psp_pk_test_ + 24 letters and digits',
      'PSP_API_SECRET has leading or trailing whitespace',
      'PSP_API_PREVIOUS_SECRET must look like psp_sk_test_ + 36 letters and digits',
    ]);
    expect(found.join('\n')).not.toContain(SHOP_SECRET);
  });

  describe('the testnet guard (APP_TESTNET_ONLY, on unless false)', () => {
    const GUARD = { ...BASE_ENV, APP_TESTNET_ONLY: 'true' };

    it('is on by default: unset or empty refuses a live pair', () => {
      const flags: Record<string, string>[] = [{}, { APP_TESTNET_ONLY: '' }];
      for (const flag of flags) {
        expect(problems({ ...BASE_ENV, ...flag, PSP_API_KEY: LIVE_KEY, PSP_API_SECRET: LIVE_SECRET })).toEqual([
          'APP_TESTNET_ONLY=true: PSP_API_KEY is a live (mainnet) key psp_pk_live_…',
          'APP_TESTNET_ONLY=true: PSP_API_SECRET is a live (mainnet) secret psp_sk_live_…',
        ]);
      }
    });

    it('refuses a live key or a live secret', () => {
      expect(problems({ ...GUARD, PSP_API_KEY: LIVE_KEY, PSP_API_SECRET: LIVE_SECRET })).toEqual([
        'APP_TESTNET_ONLY=true: PSP_API_KEY is a live (mainnet) key psp_pk_live_…',
        'APP_TESTNET_ONLY=true: PSP_API_SECRET is a live (mainnet) secret psp_sk_live_…',
      ]);
      expect(problems({ ...GUARD, PSP_API_PREVIOUS_SECRET: LIVE_SECRET })).toEqual([
        'PSP_API_PREVIOUS_SECRET belongs to another network than the testnet PSP_API_KEY',
        'APP_TESTNET_ONLY=true: PSP_API_PREVIOUS_SECRET is a live (mainnet) secret psp_sk_live_…',
      ]);
      expect(loadConfig({ ...GUARD, PSP_API_KEY: TEST_KEY, PSP_API_SECRET: TEST_SECRET })).toMatchObject({
        net: 'testnet',
        testnetOnly: true,
      });
    });

    it('refuses a key and a secret of different networks, with or without the guard', () => {
      expect(problems({ ...GUARD, PSP_API_KEY: TEST_KEY, PSP_API_SECRET: LIVE_SECRET })).toContain(
        'PSP_API_SECRET belongs to another network than the testnet PSP_API_KEY',
      );
      expect(
        problems({ ...BASE_ENV, APP_TESTNET_ONLY: 'false', PSP_API_KEY: LIVE_KEY, PSP_API_SECRET: TEST_SECRET }),
      ).toEqual(['PSP_API_SECRET belongs to another network than the mainnet PSP_API_KEY']);
    });

    it('only an explicit false lets a mainnet pair through; other values are refused', () => {
      const c = loadConfig({
        ...BASE_ENV,
        APP_TESTNET_ONLY: 'false',
        PSP_API_KEY: LIVE_KEY,
        PSP_API_SECRET: LIVE_SECRET,
      });
      expect(c).toMatchObject({ net: 'mainnet', testnetOnly: false });
      expect(problems({ ...BASE_ENV, APP_TESTNET_ONLY: 'yes' })).toEqual(['APP_TESTNET_ONLY must be true or false']);
    });
  });

  it('APP_UPSTREAM_TIMEOUT_MS: 180 s by default, 1–600000', () => {
    expect(loadConfig({ ...BASE_ENV, APP_UPSTREAM_TIMEOUT_MS: '1500' }).upstreamTimeoutMs).toBe(1500);
    expect(problems({ ...BASE_ENV, APP_UPSTREAM_TIMEOUT_MS: '0' })).toEqual([
      'APP_UPSTREAM_TIMEOUT_MS must be an integer from 1 to 600000',
    ]);
  });

  it('APP_UI_DIR must hold index.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plain-ui-'));
    expect(problems({ ...BASE_ENV, APP_UI_DIR: dir })).toEqual([
      'APP_UI_DIR must be a folder with index.html (a built UI)',
    ]);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    expect(loadConfig({ ...BASE_ENV, APP_UI_DIR: dir }).uiDir).toBe(dir);
  });
});
