import { NestFactory } from '@nestjs/core';
import type { LogLevel } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { nestLogLevels, type AppConfig } from './config/app-config';
import type { Runtime } from './config/config.module';
import { ExampleExceptionFilter } from './example/example-exception.filter';
import { configureHttp } from './example/http-setup';

export interface CreateAppOptions extends Runtime {
  /** `false` silences Nest (tests); default: the levels of LOG_LEVEL. */
  logger?: false | LogLevel[];
}

/** The app, ready to listen. main.ts starts it; the tests start it against a stub of the platform. */
export async function createApp(config: AppConfig, options: CreateAppOptions = {}): Promise<NestExpressApplication> {
  const { logger, ...runtime } = options;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, runtime), {
    // Our own parsers in configureHttp: raw bytes for the webhook receiver, JSON for /api
    bodyParser: false,
    logger: logger ?? nestLogLevels(config.logLevel),
    abortOnError: false,
  });
  configureHttp(app, config);
  app.useGlobalFilters(new ExampleExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
