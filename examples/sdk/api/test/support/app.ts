// Starts the backend on 127.0.0.1 with a test environment and talks to it with fetch.
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config/app-config';
import type { Runtime } from '../../src/config/config.module';

export const API_KEY = 'psp_pk_test_Ab12Cd34Ef56Gh78Ij90Kl12';
export const API_SECRET = 'psp_sk_test_Zz98Yy76Xx54Ww32Vv10Uu98Tt76Ss54Rr32';
export const CHECKOUT_URL = 'https://pay.psp.qubiq.cc';

export function testEnv(apiUrl: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PSP_API_URL: apiUrl,
    PSP_API_KEY: API_KEY,
    PSP_API_SECRET: API_SECRET,
    PSP_CHECKOUT_URL: CHECKOUT_URL,
    APP_PUBLIC_URL: 'https://sdk-example.test',
    APP_TESTNET_ONLY: 'true',
    ...extra,
  };
}

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  close(): Promise<void>;
}

export async function startApp(env: Record<string, string>, runtime: Runtime = {}): Promise<TestApp> {
  const app = await createApp(loadConfig(env), { logger: false, retryBaseDelayMs: 1, ...runtime });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { app, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}
