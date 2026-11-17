// Example plumbing: `GET /api/config` — what this deployment is connected to. Never any part of the secret.
import { Controller, Get, Inject } from '@nestjs/common';
import type { components } from '@psp-examples/contract/types';
import { PspClient, VERSION } from '@qubiq-psp/sdk';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { APP_VERSION } from '../version';

type Config = components['schemas']['Config'];

@Controller('api/config')
export class ConfigController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PspClient) private readonly psp: PspClient,
  ) {}

  @Get()
  get(): Config {
    return {
      backend: 'sdk',
      version: APP_VERSION,
      sdkVersion: VERSION,
      // psp.net comes from the key prefix: psp_pk_live_… is mainnet, anything else testnet
      net: this.psp.net,
      apiUrl: this.config.psp.apiUrl,
      keyId: this.psp.apiKey,
      previousSecretSet: this.config.psp.previousApiSecret !== undefined,
      checkoutUrl: this.config.psp.checkoutUrl,
      webhookUrl: this.config.webhookUrl,
      serverTime: new Date().toISOString(),
    };
  }
}
