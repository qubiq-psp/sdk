import { Module, type DynamicModule } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { BalancesModule } from './balances/balances.module';
import { CheckoutModule } from './checkout/checkout.module';
import type { AppConfig } from './config/app-config';
import { ConfigModule, type Runtime } from './config/config.module';
import { DepositsModule } from './deposits/deposits.module';
import { ExampleModule } from './example/example.module';
import { RequestLogModule } from './example/request-log/request-log.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NetworksModule } from './networks/networks.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PspModule } from './psp/psp.module';
import { WebhookSettingsModule } from './webhook-settings/webhook-settings.module';
import { WebhooksModule } from './webhooks/webhooks.module';

/** One module per area of the Merchant API; the example plumbing (request log, SSE, config) apart. */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, runtime: Runtime = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config, runtime),
        RequestLogModule,
        PspModule,
        // The areas: each controller calls the SDK methods of its area
        AccountModule,
        InvoicesModule,
        CheckoutModule,
        BalancesModule,
        DepositsModule,
        PayoutsModule,
        NetworksModule,
        WebhookSettingsModule,
        WebhooksModule,
        ExampleModule,
      ],
    };
  }
}
