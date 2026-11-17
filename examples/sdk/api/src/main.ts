import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createApp } from './app';
import { ConfigError, loadConfig, type AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  // A local .env, if there is one; variables of the process win
  if (existsSync('.env')) process.loadEnvFile('.env');

  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // The message names the variables and the rules, never their values
    console.error(err.message);
    process.exit(1);
  }

  const app = await createApp(config);
  await app.listen(config.port, config.host);

  const logger = new Logger('Bootstrap');
  logger.log(`Listening on http://${config.host}:${config.port}${config.uiDir ? ` (UI from ${config.uiDir})` : ''}`);
  logger.log(
    `Merchant API ${config.psp.apiUrl}, key ${config.psp.apiKey}${config.testnetOnly ? ', testnet only' : ''}; ` +
      `webhook URL ${config.webhookUrl ?? '— (set APP_PUBLIC_URL)'}`,
  );
}

void bootstrap();
