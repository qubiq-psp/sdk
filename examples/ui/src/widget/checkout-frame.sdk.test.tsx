import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutFrame, widgetInfo } from './checkout-frame.sdk';
import type { WidgetEvent } from './types';

const ORIGIN = 'https://pay.psp.qubiq.cc';
const URL_ = `${ORIGIN}/#v1.payload.signature`;
const INVOICE = '32ddde90-754b-4ef9-b5f6-2fd75726af14';

describe('sdk widget: <PspCheckout> of @qubiq-psp/react', () => {
  it('maps the component callbacks to widget events and checks the origin', () => {
    const events: WidgetEvent[] = [];
    render(<CheckoutFrame url={URL_} checkoutOrigin={ORIGIN} onEvent={(e) => events.push(e)} />);
    const frame = screen.getByTitle<HTMLIFrameElement>('Payment');
    expect(frame.getAttribute('src')).toBe(URL_);
    const post = (data: unknown, origin = ORIGIN) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }));
      });
    post({
      source: 'psp-checkout',
      v: 1,
      type: 'ready',
      status: 'active',
      invoiceId: INVOICE,
      linkExpiresAt: '2026-11-18T00:00:00Z',
    });
    post({
      source: 'psp-checkout',
      v: 1,
      type: 'status',
      status: 'paid',
      invoiceId: INVOICE,
      paidAt: '2026-11-17T12:00:00Z',
    });
    post({ source: 'psp-checkout', v: 1, type: 'error', code: 'unavailable' });
    post(
      { source: 'psp-checkout', v: 1, type: 'status', status: 'expired', invoiceId: INVOICE },
      'https://evil.example',
    );
    expect(events.map((e) => e.type)).toEqual(['ready', 'status', 'paid', 'error']);
    expect(widgetInfo.variant).toBe('sdk');
  });
});
