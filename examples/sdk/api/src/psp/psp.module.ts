// The SDK client as a NestJS provider: inject `PspClient` anywhere by its class (`@Inject(PspClient)`).
// One client per API key, created once and reused for every call: it holds no connections of its own.
import { Global, Logger, Module } from '@nestjs/common';
import { PspClient } from '@qubiq-psp/sdk';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RUNTIME, type Runtime } from '../config/config.module';
import { RequestLogService } from '../example/request-log/request-log.service';
import { APP_VERSION } from '../version';

@Global()
@Module({
  providers: [
    {
      provide: PspClient,
      inject: [APP_CONFIG, RUNTIME, RequestLogService],
      useFactory: (config: AppConfig, runtime: Runtime, requestLog: RequestLogService): PspClient => {
        const logger = new Logger('PspClient');
        return new PspClient({
          // Passed explicitly from the checked config; without them the SDK reads the same variables itself
          baseUrl: config.psp.apiUrl,
          apiKey: config.psp.apiKey,
          apiSecret: config.psp.apiSecret,
          previousApiSecret: config.psp.previousApiSecret,
          checkoutUrl: config.psp.checkoutUrl,
          userAgent: `psp-examples-sdk-api/${APP_VERSION}`,
          // timeoutMs, maxRetries, retryBaseDelayMs, maxRetryAfterSeconds: the SDK defaults (gateway docs 13.10) —
          // 180 s per attempt, up to 4 retries after 1, 2, 4, 8 s, Retry-After up to 30 s. Only tests shorten the pauses.
          ...(runtime.retryBaseDelayMs === undefined ? {} : { retryBaseDelayMs: runtime.retryBaseDelayMs }),

          // Example plumbing: a fetch that records every attempt in the request log. A merchant passes nothing here.
          fetch: requestLog.recordingFetch((input, init) => fetch(input, init)),
          onRetry: (info) => {
            requestLog.noteRetry(info);
            logger.warn(
              `${info.operationId}: attempt ${info.attempt} failed (${info.error.name}), retrying in ${info.delayMs} ms`,
            );
          },
          // The SDK never logs by itself: these hooks are its logging. None of them carries the secret.
          onResponse: ({ operationId, method, status, requestId, attempt, durationMs }) => {
            logger.debug(
              `${operationId} ${method} → ${status ?? 'no answer'} in ${durationMs} ms (attempt ${attempt}, X-Request-Id ${requestId ?? '—'})`,
            );
          },
          // deprecated_api_key: deploy the new key within 60 min; webhook_previous_secret: drop the old secret soon
          onWarning: (warning) => {
            logger.warn(`${warning.code}: ${warning.message}`);
          },
        });
      },
    },
  ],
  exports: [PspClient],
})
export class PspModule {}
