// Entry point: check the environment, start the server, stop cleanly on SIGTERM.
import { buildApp } from './app.ts';
import { ConfigError, loadConfig, type Config } from './config.ts';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  process.stderr.write(`${err.message}\nSee .env.example and the README, "Environment".\n`);
  process.exit(1);
}

const { app } = await buildApp({ config });

let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    void app.close().finally(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
// The key is public; the secret is never logged
app.log.info(
  {
    apiUrl: config.apiUrl,
    keyId: config.apiKey,
    net: config.net,
    checkoutUrl: config.checkoutUrl,
    webhookUrl: config.webhookUrl,
    testnetOnly: config.testnetOnly,
    ui: config.uiDir !== null,
  },
  'plain example backend ready',
);
