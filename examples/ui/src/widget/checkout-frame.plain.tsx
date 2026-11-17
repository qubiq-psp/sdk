// The payment widget of the `plain` build: a plain iframe and our own handling of the payment page's messages.
// Nothing here comes from @qubiq-psp/*: scripts/check-bundles.mjs and the Vite build check that.
import { useEffect, useRef, useState } from 'react';
import { checkMessage, frameHeight, linkOrigin } from './plain-protocol';
import type { CheckoutFrameProps, WidgetInfo } from './types';

export const widgetInfo: WidgetInfo = {
  variant: 'plain',
  label: 'plain iframe',
  description:
    'This build shows the payment page in a plain <iframe> and checks its postMessage events itself: the origin of the link, the window of this frame and the fields of each message.',
};

/** Frame height until the first `resize`. */
const INITIAL_HEIGHT = 640;
const PAID: ReadonlySet<unknown> = new Set(['paid', 'overpaid']);
const EXPIRED: ReadonlySet<unknown> = new Set(['expired', 'expired_partial']);

export function CheckoutFrame({ url, checkoutOrigin, onEvent, title = 'Payment' }: CheckoutFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The height the page reported, for the link it reported it for: a new link starts from the initial height
  const [measured, setMeasured] = useState<{ url: string; height: number } | null>(null);
  const height = measured?.url === url ? measured.height : INITIAL_HEIGHT;
  const origin = linkOrigin(url, checkoutOrigin);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (origin === null) {
      handler.current({ type: 'error', fields: { code: 'link_invalid', reason: 'not a link of the checkout origin' } });
      return undefined;
    }
    let status: unknown = undefined;
    let paid = false;
    let expired = false;
    const onMessage = (event: MessageEvent) => {
      const check = checkMessage(event, { origin, window: frame.current?.contentWindow ?? null });
      if (!check) return;
      if (check.kind === 'rejected') {
        handler.current({ type: 'rejected', fields: { reason: check.reason, origin: event.origin } });
        return;
      }
      const { type, fields } = check;
      if (type === 'resize') {
        const h = frameHeight(fields['height']);
        if (h) setMeasured({ url, height: h });
      }
      handler.current({ type: type as 'ready' | 'status' | 'resize' | 'error', fields });
      if (type === 'ready' || type === 'status') {
        if (fields['status'] === status && type === 'status') return;
        status = fields['status'];
        if (!paid && PAID.has(status)) {
          paid = true;
          handler.current({ type: 'paid', fields: { status } });
        }
        if (!expired && EXPIRED.has(status)) {
          expired = true;
          handler.current({ type: 'expired', fields: { status } });
        }
      }
    };
    window.addEventListener('message', onMessage);
    // The page loads only now, with the listener in place: its one `ready` must not be lost
    if (frame.current && frame.current.getAttribute('src') !== url) frame.current.setAttribute('src', url);
    return () => window.removeEventListener('message', onMessage);
  }, [url, origin]);

  if (origin === null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The link is not a link of the payment page {checkoutOrigin}: the frame is not shown.
      </p>
    );
  }
  return (
    <iframe
      // A new link is a new frame: a change of the part after `#` alone would not reload the page
      key={url}
      ref={frame}
      title={title}
      allow="clipboard-write"
      referrerPolicy="no-referrer"
      style={{ height }}
      className="block w-full border-0"
    />
  );
}
