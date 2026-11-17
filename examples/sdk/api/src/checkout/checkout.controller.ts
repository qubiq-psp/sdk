// Payment widget — psp.checkout.createUrl(): a signed link to the payment page of an invoice, built offline with the
// API secret (gateway docs 20.2–20.3). No platform call, so no request-log entry: the page checks the invoice itself.
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { components } from '@psp-examples/contract/types';
import { PspClient } from '@qubiq-psp/sdk';
import { ExampleError } from '../example/example-error';

type CheckoutLink = components['schemas']['CheckoutLink'];

const OPTIONS = new Set(['branding', 'locale', 'expiresInSeconds']);

@Controller('api/invoices/:invoiceId/checkout-link')
export class CheckoutController {
  constructor(@Inject(PspClient) private readonly psp: PspClient) {}

  /**
   * `{ branding?, locale?, expiresInSeconds? }` → `{ url, token, expiresAt }`. Show `url` in an iframe or pass it to
   * `<PspCheckout url>` of `@qubiq-psp/react`. Build a link only for the buyer who owns the order: whoever has it sees
   * the invoice.
   */
  @Post()
  @HttpCode(200)
  create(@Param('invoiceId') invoiceId: string, @Body() body: unknown): CheckoutLink {
    const options: unknown = body ?? {};
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw ExampleError.invalid('body', 'must be an object');
    }
    const unknown = Object.keys(options).find((key) => !OPTIONS.has(key));
    if (unknown !== undefined) throw ExampleError.invalid(unknown, 'is not an option of the link');
    const branding: unknown = (options as Record<string, unknown>)['branding'];
    if (branding !== undefined && (branding === null || typeof branding !== 'object' || Array.isArray(branding))) {
      throw ExampleError.invalid('branding', 'must be an object');
    }
    try {
      // The SDK checks the options (the gateway rules of 20.3) and throws TypeError on a bad one
      return this.psp.checkout.createUrl(invoiceId, options);
    } catch (err) {
      // «branding.logoUrl must be https» → field branding.logoUrl
      if (err instanceof TypeError) {
        throw ExampleError.invalid(/^[A-Za-z.]+/.exec(err.message)?.[0] ?? 'body', err.message);
      }
      throw err;
    }
  }
}
