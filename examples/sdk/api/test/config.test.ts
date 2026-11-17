import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, nestLogLevels } from '../src/config/app-config';
import { API_KEY, API_SECRET, testEnv } from './support/app';
import pkg from '../package.json';
import { APP_VERSION } from '../src/version';

const LIVE_KEY = 'psp_pk_live_Ab12Cd34Ef56Gh78Ij90Kl12';
const LIVE_SECRET = 'psp_sk_live_Zz98Yy76Xx54Ww32Vv10Uu98Tt76Ss54Rr32';
const PREVIOUS_SECRET = 'psp_sk_test_Pp11Qq22Rr33Ss44Tt55Uu66Vv77Ww88Xx99';

function errorOf(env: Record<string, string>): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  it('reads a valid environment with the defaults', () => {
    const config = loadConfig({
      PSP_API_URL: 'https://api.psp.qubiq.cc/',
      PSP_API_KEY: API_KEY,
      PSP_API_SECRET: API_SECRET,
      PSP_CHECKOUT_URL: 'https://pay.psp.qubiq.cc',
    });
    expect(config).toMatchObject({
      psp: { apiUrl: 'https://api.psp.qubiq.cc', apiKey: API_KEY, checkoutUrl: 'https://pay.psp.qubiq.cc' },
      publicUrl: null,
      webhookUrl: null,
      testnetOnly: false,
      host: '127.0.0.1',
      port: 4900,
      uiDir: null,
      logLimit: 1000,
      upstreamTimeoutMs: 180000,
      logLevel: 'log',
    });
    expect(config.psp.apiSecret).toBe(API_SECRET);
    expect(config.psp.previousApiSecret).toBeUndefined();
  });

  it('takes the optional variables', () => {
    const config = loadConfig(
      testEnv('http://localhost:8080', {
        PSP_API_PREVIOUS_SECRET: PREVIOUS_SECRET,
        APP_PUBLIC_URL: 'https://sdk-example.psp.qubiq.cc/',
        HOST: '0.0.0.0',
        PORT: '5000',
        APP_LOG_LIMIT: '20',
        APP_UPSTREAM_TIMEOUT_MS: '1500',
        LOG_LEVEL: 'debug',
      }),
    );
    expect(config.psp.previousApiSecret).toBe(PREVIOUS_SECRET);
    expect(config.webhookUrl).toBe('https://sdk-example.psp.qubiq.cc/webhooks/psp');
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 5000,
      logLimit: 20,
      upstreamTimeoutMs: 1500,
      logLevel: 'debug',
    });
    expect(nestLogLevels('debug')).toEqual(['fatal', 'error', 'warn', 'log', 'debug']);
  });

  it('lists every missing variable', () => {
    const message = errorOf({});
    for (const name of ['PSP_API_URL', 'PSP_API_KEY', 'PSP_API_SECRET', 'PSP_CHECKOUT_URL']) {
      expect(message).toContain(`${name} is required`);
    }
  });

  it('refuses malformed values without printing them', () => {
    const message = errorOf({
      PSP_API_URL: 'http://api.psp.qubiq.cc',
      PSP_API_KEY: 'psp_sk_test_notakey',
      PSP_API_SECRET: API_KEY,
      PSP_API_PREVIOUS_SECRET: 'nope',
      PSP_CHECKOUT_URL: 'https://pay.psp.qubiq.cc/?x=1',
      APP_PUBLIC_URL: 'not a url',
      APP_TESTNET_ONLY: 'yes',
      PORT: '70000',
      APP_LOG_LIMIT: '0',
      APP_UPSTREAM_TIMEOUT_MS: '0',
      LOG_LEVEL: 'loud',
    });
    expect(message).toContain('PSP_API_URL must be https://');
    expect(message).toContain('PSP_API_KEY must look like');
    expect(message).toContain('PSP_API_SECRET must look like');
    expect(message).toContain('PSP_API_PREVIOUS_SECRET must look like');
    expect(message).toContain('PSP_CHECKOUT_URL must not contain a query');
    expect(message).toContain('APP_PUBLIC_URL must be a URL');
    expect(message).toContain('APP_TESTNET_ONLY must be true or false');
    expect(message).toContain('PORT must be an integer from 1 to 65535');
    expect(message).toContain('APP_LOG_LIMIT must be an integer from 1 to 100000');
    expect(message).toContain('APP_UPSTREAM_TIMEOUT_MS must be an integer');
    expect(message).toContain('LOG_LEVEL must be one of');
    // A key pasted into the secret variable is not echoed
    expect(message).not.toContain(API_KEY);
    expect(message).not.toContain('notakey');
  });

  it('refuses a key and a secret of different networks', () => {
    expect(errorOf(testEnv('https://a.test', { APP_TESTNET_ONLY: 'false', PSP_API_KEY: LIVE_KEY }))).toContain(
      'belong to different networks',
    );
    expect(
      errorOf(
        testEnv('https://a.test', {
          APP_TESTNET_ONLY: 'false',
          PSP_API_KEY: LIVE_KEY,
          PSP_API_SECRET: LIVE_SECRET,
          PSP_API_PREVIOUS_SECRET: PREVIOUS_SECRET,
        }),
      ),
    ).toContain('PSP_API_PREVIOUS_SECRET belongs to another network');
  });

  describe('APP_TESTNET_ONLY', () => {
    const live = { PSP_API_KEY: LIVE_KEY, PSP_API_SECRET: LIVE_SECRET };

    it('true refuses to start with a live key and secret', () => {
      const message = errorOf(testEnv('https://a.test', { ...live, APP_TESTNET_ONLY: 'true' }));
      expect(message).toContain('APP_TESTNET_ONLY=true: refusing to start with a live key or secret');
      expect(message).not.toContain(LIVE_SECRET);
    });

    it('true refuses a live secret even next to a malformed key', () => {
      expect(
        errorOf(
          testEnv('https://a.test', { PSP_API_KEY: 'bad', PSP_API_SECRET: LIVE_SECRET, APP_TESTNET_ONLY: 'true' }),
        ),
      ).toContain('APP_TESTNET_ONLY=true');
    });

    it('true accepts a testnet key', () => {
      expect(loadConfig(testEnv('https://a.test', { APP_TESTNET_ONLY: 'true' })).testnetOnly).toBe(true);
    });

    it('false or unset lets a live key through (local runs only)', () => {
      expect(loadConfig(testEnv('https://a.test', { ...live, APP_TESTNET_ONLY: 'false' })).psp.apiKey).toBe(LIVE_KEY);
      const env = testEnv('https://a.test', live);
      delete env['APP_TESTNET_ONLY'];
      expect(loadConfig(env).testnetOnly).toBe(false);
    });
  });

  it('checks APP_UI_DIR', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdk-api-ui-'));
    expect(errorOf(testEnv('https://a.test', { APP_UI_DIR: dir }))).toContain('APP_UI_DIR must be a folder');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    expect(loadConfig(testEnv('https://a.test', { APP_UI_DIR: dir })).uiDir).toBe(dir);
  });

  it('never shows the secrets', () => {
    const config = loadConfig(testEnv('https://a.test', { PSP_API_PREVIOUS_SECRET: PREVIOUS_SECRET }));
    expect(JSON.stringify(config)).not.toContain(API_SECRET);
    expect(JSON.stringify(config)).not.toContain(PREVIOUS_SECRET);
    expect(inspect(config, { depth: 10 })).not.toContain(API_SECRET);
  });
});

it('APP_VERSION equals the version of package.json', () => {
  expect(APP_VERSION).toBe(pkg.version);
});
