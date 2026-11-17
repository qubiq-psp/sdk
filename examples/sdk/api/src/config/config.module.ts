import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './app-config';

/**
 * What the tests replace: the clock (webhook timestamps) and the pause between SDK retries. Production uses the
 * defaults: `Date.now` and the SDK's own policy (1, 2, 4, 8 s).
 */
export interface Runtime {
  now?: () => number;
  /** Only for tests: `retryBaseDelayMs` of the SDK, to run the retry paths in milliseconds. */
  retryBaseDelayMs?: number;
}

export const RUNTIME = Symbol('RUNTIME');

/** The checked environment as `@Inject(APP_CONFIG) config: AppConfig`, and the runtime. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig, runtime: Runtime = {}): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: RUNTIME, useValue: runtime },
      ],
      exports: [APP_CONFIG, RUNTIME],
    };
  }
}
