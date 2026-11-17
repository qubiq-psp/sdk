// The environment of the backend, read and checked once at startup. A missing or malformed variable stops the start
// with a message that names the variable and the rule — never the value: a secret pasted into the wrong variable must
// not end up in a log.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LogLevel } from '@nestjs/common';

/** Settings of the Merchant API connection. The two secrets are non-enumerable: not in `JSON.stringify`, not in logs. */
export interface PspSettings {
  /** `PSP_API_URL` — base URL of the Merchant API. */
  readonly apiUrl: string;
  /** `PSP_API_KEY` — `psp_pk_test_…` (public). */
  readonly apiKey: string;
  /** `PSP_API_SECRET` — signs requests, widget links and verifies webhooks. Never sent, logged or returned. */
  readonly apiSecret: string;
  /** `PSP_API_PREVIOUS_SECRET` — the receiver also accepts webhooks signed with it during a rotation. */
  readonly previousApiSecret: string | undefined;
  /** `PSP_CHECKOUT_URL` — the payment page, e.g. `https://pay.psp.qubiq.cc`. */
  readonly checkoutUrl: string;
}

export interface AppConfig {
  readonly psp: PspSettings;
  /** `APP_PUBLIC_URL` without a trailing slash; `null` when not set. */
  readonly publicUrl: string | null;
  /** `${APP_PUBLIC_URL}/webhooks/psp` — the URL to set with `PUT /api/webhook`; `null` without `APP_PUBLIC_URL`. */
  readonly webhookUrl: string | null;
  /** `APP_TESTNET_ONLY`, on unless `false` — a live key or secret stops the start. */
  readonly testnetOnly: boolean;
  readonly host: string;
  readonly port: number;
  /** `APP_UI_DIR` — absolute path of a built UI to serve, or `null`. */
  readonly uiDir: string | null;
  /** `APP_LOG_LIMIT` — how many request-log entries and received webhooks are kept in memory. */
  readonly logLimit: number;
  /** `APP_LOG_MAX_BYTES` — how many bytes of each log are kept (their JSON), default 32 MB. */
  readonly logMaxBytes: number;
  /** `APP_UPSTREAM_TIMEOUT_MS` — timeout of one attempt to the platform (`timeoutMs` of the SDK), default 180 000. */
  readonly upstreamTimeoutMs: number;
  readonly logLevel: AppLogLevel;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** 32 MB per log by default. */
export const DEFAULT_LOG_MAX_BYTES = 32 * 1024 * 1024;

export const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
export type AppLogLevel = (typeof LOG_LEVELS)[number];

/** Nest logger levels enabled by `LOG_LEVEL`. */
export function nestLogLevels(level: AppLogLevel): LogLevel[] {
  return ['fatal', ...LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1)];
}

/** The same formats the SDK accepts (the request-signing rules). */
const API_KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const API_SECRET_RE = /^psp_sk_(test_|live_)?[0-9A-Za-z]{36}$/;
const LIVE_RE = /^psp_[ps]k_live_/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Thrown by {@link loadConfig}; the message lists every problem, one per line. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Readonly<Record<string, string | undefined>>;

/** Reads and checks the environment. Throws {@link ConfigError} listing every problem. */
export function loadConfig(env: Env): AppConfig {
  const problems: string[] = [];
  const value = (name: string): string | undefined => {
    const raw = env[name];
    return raw === undefined || raw === '' ? undefined : raw;
  };
  const required = (name: string): string | undefined => {
    const raw = value(name);
    if (raw === undefined) problems.push(`${name} is required`);
    return raw;
  };

  const url = (name: string, raw: string | undefined, what: string): string | undefined => {
    if (raw === undefined) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      problems.push(`${name} must be a URL, e.g. ${what}`);
      return undefined;
    }
    const local = parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) {
      problems.push(`${name} must be https:// (http:// only on localhost), e.g. ${what}`);
      return undefined;
    }
    if (parsed.search || parsed.hash || parsed.username || parsed.password) {
      problems.push(`${name} must not contain a query, a fragment or credentials`);
      return undefined;
    }
    return raw.replace(/\/+$/, '');
  };

  const credential = (name: string, raw: string | undefined, re: RegExp, example: string): string | undefined => {
    if (raw === undefined) return undefined;
    if (!re.test(raw)) {
      problems.push(`${name} must look like ${example}`);
      return undefined;
    }
    return raw;
  };

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      problems.push(`${name} must be an integer from ${min} to ${max}`);
      return fallback;
    }
    return Number(raw);
  };

  const apiUrl = url('PSP_API_URL', required('PSP_API_URL'), 'https://api.psp.qubiq.cc');
  const apiKey = credential('PSP_API_KEY', required('PSP_API_KEY'), API_KEY_RE, 'psp_pk_test_ + 24 letters and digits');
  const apiSecret = credential(
    'PSP_API_SECRET',
    required('PSP_API_SECRET'),
    API_SECRET_RE,
    'psp_sk_test_ + 36 letters and digits',
  );
  const previousApiSecret = credential(
    'PSP_API_PREVIOUS_SECRET',
    value('PSP_API_PREVIOUS_SECRET'),
    API_SECRET_RE,
    'psp_sk_test_ + 36 letters and digits (or be empty)',
  );
  const checkoutUrl = url('PSP_CHECKOUT_URL', required('PSP_CHECKOUT_URL'), 'https://pay.psp.qubiq.cc');
  const publicUrl = url('APP_PUBLIC_URL', value('APP_PUBLIC_URL'), 'https://sdk-example.psp.qubiq.cc');

  const live = (credential: string | undefined): boolean => credential !== undefined && LIVE_RE.test(credential);
  if (apiKey !== undefined && apiSecret !== undefined && live(apiKey) !== live(apiSecret)) {
    problems.push('PSP_API_KEY and PSP_API_SECRET belong to different networks (test_ / live_)');
  }
  if (apiSecret !== undefined && previousApiSecret !== undefined && live(apiSecret) !== live(previousApiSecret)) {
    problems.push('PSP_API_PREVIOUS_SECRET belongs to another network than PSP_API_SECRET');
  }

  const testnetOnlyRaw = value('APP_TESTNET_ONLY');
  if (testnetOnlyRaw !== undefined && testnetOnlyRaw !== 'true' && testnetOnlyRaw !== 'false') {
    problems.push('APP_TESTNET_ONLY must be true or false');
  }
  // The deployed examples talk to the testnet only: the guard is on unless APP_TESTNET_ONLY=false says otherwise, so
  // an env file that forgets the variable (or leaves it empty) cannot start the example with a live key
  const testnetOnly = testnetOnlyRaw !== 'false';
  // The deploy guard: a deployed example never holds real money
  if (testnetOnly && (live(apiKey) || live(apiSecret) || live(previousApiSecret))) {
    problems.push(
      'APP_TESTNET_ONLY=true: refusing to start with a live key or secret (psp_pk_live_… / psp_sk_live_…); use a testnet key',
    );
  }

  const host = value('HOST') ?? '127.0.0.1';
  const port = integer('PORT', 4900, 1, 65535);
  const logLimit = integer('APP_LOG_LIMIT', 1000, 1, 100_000);
  // Entries are counted by entry and by byte: 1000 large ones must not take the memory of the host
  const logMaxBytes = integer('APP_LOG_MAX_BYTES', DEFAULT_LOG_MAX_BYTES, 1024 * 1024, 1024 * 1024 * 1024);
  // The longest timer Node.js takes
  const upstreamTimeoutMs = integer('APP_UPSTREAM_TIMEOUT_MS', 180_000, 1, 2_147_483_647);

  const logLevelRaw = value('LOG_LEVEL') ?? 'log';
  const logLevel = (LOG_LEVELS as readonly string[]).includes(logLevelRaw) ? (logLevelRaw as AppLogLevel) : 'log';
  if (logLevel !== logLevelRaw) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  let uiDir: string | null = null;
  const uiDirRaw = value('APP_UI_DIR');
  if (uiDirRaw !== undefined) {
    uiDir = resolve(uiDirRaw);
    let isUi = false;
    try {
      isUi = statSync(uiDir).isDirectory() && statSync(resolve(uiDir, 'index.html')).isFile();
    } catch {
      isUi = false;
    }
    if (!isUi) problems.push('APP_UI_DIR must be a folder with index.html (a built examples/ui)');
  }

  if (
    problems.length > 0 ||
    apiUrl === undefined ||
    apiKey === undefined ||
    apiSecret === undefined ||
    checkoutUrl === undefined
  ) {
    throw new ConfigError(`Invalid environment, see .env.example:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const psp = { apiUrl, apiKey, checkoutUrl } as PspSettings;
  Object.defineProperties(psp, {
    apiSecret: { value: apiSecret, enumerable: false },
    previousApiSecret: { value: previousApiSecret, enumerable: false },
  });

  return {
    psp: Object.freeze(psp),
    publicUrl: publicUrl ?? null,
    webhookUrl: publicUrl === undefined ? null : `${publicUrl}/webhooks/psp`,
    testnetOnly,
    host,
    port,
    uiDir,
    logLimit,
    logMaxBytes,
    upstreamTimeoutMs,
    logLevel,
  };
}
