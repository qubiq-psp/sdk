// Entry point: check the environment, start the server, stop cleanly on SIGTERM.
import { createApp } from './app.ts';
import { ConfigError } from './config.ts';

const { app, config } = await createApp(process.env).catch((err: unknown) => {
  if (!(err instanceof ConfigError)) throw err;
  process.stderr.write(`${err.message}\nSee .env.example and the README, "Environment".\n`);
  process.exit(1);
});

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
    upstreamTimeoutMs: config.upstreamTimeoutMs,
    ui: config.uiDir !== null,
  },
  'plain example backend ready',
);
