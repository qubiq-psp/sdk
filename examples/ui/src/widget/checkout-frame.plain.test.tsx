import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutFrame } from './checkout-frame.plain';
import { checkMessage, frameHeight, linkOrigin } from './plain-protocol';
import type { WidgetEvent } from './types';

const ORIGIN = 'https://pay.psp.qubiq.cc';
const URL_ = `${ORIGIN}/#v1.payload.signature`;
const INVOICE = '32ddde90-754b-4ef9-b5f6-2fd75726af14';

function post(data: unknown, init: { origin?: string; source?: MessageEventSource | null } = {}) {
  const frame = screen.getByTitle<HTMLIFrameElement>('Payment');
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: init.origin ?? ORIGIN,
        source: init.source === undefined ? frame.contentWindow : init.source,
      }),
    );
  });
}

function setup() {
  const events: WidgetEvent[] = [];
  render(<CheckoutFrame url={URL_} checkoutOrigin={ORIGIN} onEvent={(e) => events.push(e)} />);
  return events;
}

describe('plain widget: checkMessage', () => {
  const win = {};
  const ok = { origin: ORIGIN, source: win };

  it('ignores messages that are not the payment page (extensions, devtools)', () => {
    expect(checkMessage({ ...ok, data: 'hello' }, { origin: ORIGIN, window: win })).toBeNull();
    expect(checkMessage({ ...ok, data: { source: 'other' } }, { origin: ORIGIN, window: win })).toBeNull();
  });

  it('rejects a message from another origin, another window or of a wrong shape', () => {
    const msg = { source: 'psp-checkout', v: 1, type: 'resize', height: 500 };
    expect(checkMessage({ ...ok, origin: 'https://evil.example', data: msg }, { origin: ORIGIN, window: win })).toEqual(
      {
        kind: 'rejected',
        reason: 'origin',
      },
    );
    expect(checkMessage({ ...ok, source: {}, data: msg }, { origin: ORIGIN, window: win })).toEqual({
      kind: 'rejected',
      reason: 'source',
    });
    expect(checkMessage({ ...ok, data: { ...msg, v: 2 } }, { origin: ORIGIN, window: win })).toEqual({
      kind: 'rejected',
      reason: 'shape',
    });
    expect(checkMessage({ ...ok, data: { ...msg, height: 'big' } }, { origin: ORIGIN, window: win })).toEqual({
      kind: 'rejected',
      reason: 'shape',
    });
  });

  it('accepts the documented messages with their fields only', () => {
    expect(
      checkMessage(
        { ...ok, data: { source: 'psp-checkout', v: 1, type: 'error', code: 'link_expired', extra: 1 } },
        { origin: ORIGIN, window: win },
      ),
    ).toEqual({ kind: 'accepted', type: 'error', fields: { code: 'link_expired' } });
  });

  it('keeps the frame height within 160 … 4000 px', () => {
    expect(frameHeight(512.2)).toBe(513);
    expect(frameHeight(10)).toBe(160);
    expect(frameHeight(10_000)).toBe(4000);
    expect(frameHeight(-1)).toBeNull();
  });

  it('accepts only links of the checkout origin with a token', () => {
    expect(linkOrigin(URL_, ORIGIN)).toBe(ORIGIN);
    expect(linkOrigin('https://evil.example/#v1.x', ORIGIN)).toBeNull();
    expect(linkOrigin(`${ORIGIN}/`, ORIGIN)).toBeNull();
    expect(linkOrigin('http://pay.psp.qubiq.cc/#v1.x', 'http://pay.psp.qubiq.cc')).toBeNull();
    expect(linkOrigin('http://localhost:5180/#v1.x', 'http://localhost:5180')).toBe('http://localhost:5180');
  });
});

describe('plain widget: CheckoutFrame', () => {
  it('loads the link and reports ready, status, paid once and resize', () => {
    const events = setup();
    const frame = screen.getByTitle<HTMLIFrameElement>('Payment');
    expect(frame.getAttribute('src')).toBe(URL_);
    expect(frame.getAttribute('allow')).toBe('clipboard-write');

    post({
      source: 'psp-checkout',
      v: 1,
      type: 'ready',
      status: 'active',
      invoiceId: INVOICE,
      linkExpiresAt: '2026-11-18T00:00:00Z',
    });
    post({ source: 'psp-checkout', v: 1, type: 'resize', height: 812 });
    post({
      source: 'psp-checkout',
      v: 1,
      type: 'status',
      status: 'paid',
      invoiceId: INVOICE,
      paidAt: '2026-11-17T12:00:00Z',
    });
    post({
      source: 'psp-checkout',
      v: 1,
      type: 'status',
      status: 'overpaid',
      invoiceId: INVOICE,
      paidAt: '2026-11-17T12:00:00Z',
    });

    expect(events.map((e) => e.type)).toEqual(['ready', 'resize', 'status', 'paid', 'status']);
    expect(events[0]!.fields).toEqual({ status: 'active', invoiceId: INVOICE, linkExpiresAt: '2026-11-18T00:00:00Z' });
    expect(frame.style.height).toBe('812px');
  });

  it('reports expired once and the page errors', () => {
    const events = setup();
    post({ source: 'psp-checkout', v: 1, type: 'status', status: 'expired', invoiceId: INVOICE, paidAt: null });
    post({ source: 'psp-checkout', v: 1, type: 'error', code: 'link_expired' });
    expect(events.map((e) => e.type)).toEqual(['status', 'expired', 'error']);
    expect(events[2]!.fields).toEqual({ code: 'link_expired' });
  });

  it('rejects messages of another origin or window and does not resize by them', () => {
    const events = setup();
    const frame = screen.getByTitle<HTMLIFrameElement>('Payment');
    const before = frame.style.height;
    post({ source: 'psp-checkout', v: 1, type: 'resize', height: 300 }, { origin: 'https://evil.example' });
    post({ source: 'psp-checkout', v: 1, type: 'resize', height: 300 }, { source: window });
    expect(events).toEqual([
      { type: 'rejected', fields: { reason: 'origin', origin: 'https://evil.example' } },
      { type: 'rejected', fields: { reason: 'source', origin: ORIGIN } },
    ]);
    expect(frame.style.height).toBe(before);
  });

  it('does not show a link of another origin', () => {
    const onEvent = vi.fn();
    render(<CheckoutFrame url="https://evil.example/#v1.x" checkoutOrigin={ORIGIN} onEvent={onEvent} />);
    expect(screen.queryByTitle('Payment')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('not a link of the payment page');
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'error', fields: { code: 'link_invalid' } });
  });

  it('stops listening when unmounted', () => {
    const events: WidgetEvent[] = [];
    const { unmount } = render(<CheckoutFrame url={URL_} checkoutOrigin={ORIGIN} onEvent={(e) => events.push(e)} />);
    unmount();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'psp-checkout', v: 1, type: 'resize', height: 1 },
        origin: ORIGIN,
      }),
    );
    expect(events).toEqual([]);
  });
});
