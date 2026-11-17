// Account — psp.account.get(): the merchant, its status and capabilities, the key of the request.
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { PspClient, type RequestOptions } from '@qubiq-psp/sdk';
import type { Response } from 'express';
import { MerchantApiCall, PspRequestOptions, sendSdkResult } from '../example/passthrough';

@Controller('api/account')
export class AccountController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /**
   * A cheap check of the key, the secret, the IP allowlist and the clock. `apiKey.status: 'previous'` and the
   * `X-Api-Key-Deprecated` header mean the request was signed with the previous key after a rotation.
   */
  @Get()
  @MerchantApiCall('getAccount')
  async get(@PspRequestOptions() options: RequestOptions, @Res() res: Response): Promise<void> {
    sendSdkResult(res, await this.psp.account.get(options));
  }
}
