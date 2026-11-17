// The environment of the backend: one merchant per deployment. Everything is checked at start; a wrong value stops
// the process with a message that names the variable but never prints a credential.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

export type Net = 'testnet' | 'mainnet';

export interface Config {
  /** Merchant API origin, e.g. `https://api.psp.qubiq.cc`. Only from the environment, never from a request. */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  previousApiSecret: string | null;
  /** By the key prefix: `psp_pk_live_…` — mainnet, any other — testnet. */
  net: Net;
  /** Origin of the payment page. */
  checkoutUrl: string;
  /** Public origin of this deployment; `null` — unknown, so no webhook URL to show. */
  publicUrl: string | null;
  /** `${publicUrl}/webhooks/psp` or `null`. */
  webhookUrl: string | null;
  testnetOnly: boolean;
  /** Timeout of one platform attempt, ms. */
  upstreamTimeoutMs: number;
  host: string;
  port: number;
  /** A built UI to serve, or `null`. */
  uiDir: string | null;
  /** How many request-log entries and received webhooks are kept in memory, each. */
  logLimit: number;
  /** How many bytes of request-log entries and of received webhooks are kept in memory, each. */
  logMaxBytes: number;
  logLevel: string;
}

const KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const SECRET_RE = /^psp_sk_(test_|live_)?[0-9A-Za-z]{36}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** 32 MB per log by default. */
export const DEFAULT_LOG_MAX_BYTES = 32 * 1024 * 1024;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export const netOf = (credential: string): Net => (/^psp_[ps]k_live_/.test(credential) ? 'mainnet' : 'testnet');

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Reads and checks the environment. Empty values count as unset. Throws {@link ConfigError} listing every problem.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const get = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };

  /** An origin: scheme, host and port only. https, or http on this machine (local development and tests). */
  const origin = (name: string, required: boolean, fallback?: string): string | null => {
    const raw = get(name) ?? fallback;
    if (raw === undefined) {
      if (required) problems.push(`${name} is required`);
      return null;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${name} is not a valid URL`);
      return null;
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
      problems.push(`${name} must be https:// (plain http only for localhost and 127.0.0.1)`);
      return null;
    }
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || raw.includes('#')) {
      problems.push(`${name} must be an origin like https://host[:port], without a path, query, fragment or login`);
      return null;
    }
    return url.origin;
  };

  /** A credential: the message names the variable and the expected shape, never the value. */
  const credential = (name: string, re: RegExp, shape: string, required: boolean): string | null => {
    const value = get(name);
    if (value === undefined) {
      if (required) problems.push(`${name} is required`);
      return null;
    }
    if (value !== value.trim()) {
      problems.push(`${name} has leading or trailing whitespace`);
      return null;
    }
    if (!re.test(value)) {
      problems.push(`${name} must look like ${shape}`);
      return null;
    }
    return value;
  };

  const flag = (name: string, fallback: boolean): boolean => {
    const value = get(name);
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    problems.push(`${name} must be true or false`);
    return fallback;
  };

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const value = get(name);
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!/^[0-9]+$/.test(value) || n < min || n > max) {
      problems.push(`${name} must be an integer from ${min} to ${max}`);
      return fallback;
    }
    return n;
  };

  const apiUrl = origin('PSP_API_URL', true);
  const apiKey = credential('PSP_API_KEY', KEY_RE, 'psp_pk_test_ + 24 letters and digits', true);
  const apiSecret = credential('PSP_API_SECRET', SECRET_RE, 'psp_sk_test_ + 36 letters and digits', true);
  const previous = credential('PSP_API_PREVIOUS_SECRET', SECRET_RE, 'psp_sk_test_ + 36 letters and digits', false);
  const checkoutUrl = origin('PSP_CHECKOUT_URL', true);
  const publicUrl = origin('APP_PUBLIC_URL', false);
  // The deployed examples talk to the testnet only: the guard is on unless APP_TESTNET_ONLY=false says otherwise, so
  // an env file that forgets the variable (or leaves it empty) cannot start the example with a live key
  const testnetOnly = flag('APP_TESTNET_ONLY', true);
  // The platform answers any request within 180 s; a shorter timeout turns a slow success, e.g.
  // of createPayout, into an unknown outcome
  const upstreamTimeoutMs = integer('APP_UPSTREAM_TIMEOUT_MS', 180_000, 1, 600_000);
  const host = get('HOST') ?? '127.0.0.1';
  const port = integer('PORT', 4600, 1, 65_535);
  const logLimit = integer('APP_LOG_LIMIT', 1000, 1, 100_000);
  // Entries are counted by entry and by byte: 1000 large ones must not take the memory of the host
  const logMaxBytes = integer('APP_LOG_MAX_BYTES', DEFAULT_LOG_MAX_BYTES, 1024 * 1024, 1024 * 1024 * 1024);
  const logLevel = get('LOG_LEVEL') ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  let uiDir: string | null = null;
  const rawUiDir = get('APP_UI_DIR');
  if (rawUiDir !== undefined) {
    uiDir = resolve(rawUiDir);
    if (!statSync(resolve(uiDir, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
      problems.push('APP_UI_DIR must be a folder with index.html (a built UI)');
    }
  }

  // Networks of the credentials: the key decides; the secrets must be of the same network
  const net = apiKey ? netOf(apiKey) : 'testnet';
  if (apiKey && apiSecret && netOf(apiSecret) !== net) {
    problems.push(`PSP_API_SECRET belongs to another network than the ${net} PSP_API_KEY`);
  }
  if (apiKey && previous && netOf(previous) !== net) {
    problems.push(`PSP_API_PREVIOUS_SECRET belongs to another network than the ${net} PSP_API_KEY`);
  }
  if (testnetOnly) {
    if (apiKey && netOf(apiKey) === 'mainnet') {
      problems.push('APP_TESTNET_ONLY=true: PSP_API_KEY is a live (mainnet) key psp_pk_live_…');
    }
    for (const [name, value] of [
      ['PSP_API_SECRET', apiSecret],
      ['PSP_API_PREVIOUS_SECRET', previous],
    ] as const) {
      if (value && netOf(value) === 'mainnet') {
        problems.push(`APP_TESTNET_ONLY=true: ${name} is a live (mainnet) secret psp_sk_live_…`);
      }
    }
  }

  if (problems.length || !apiUrl || !apiKey || !apiSecret || !checkoutUrl) throw new ConfigError(problems);
  return {
    apiUrl,
    apiKey,
    apiSecret,
    previousApiSecret: previous,
    net,
    checkoutUrl,
    publicUrl,
    webhookUrl: publicUrl ? `${publicUrl}/webhooks/psp` : null,
    testnetOnly,
    upstreamTimeoutMs,
    host,
    port,
    uiDir,
    logLimit,
    logMaxBytes,
    logLevel,
  };
}
