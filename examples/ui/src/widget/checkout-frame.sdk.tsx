// The payment widget of the `sdk` build: <PspCheckout> of @qubiq-psp/react. The component checks the origin and the
// window of every message itself and sets the frame height by `resize`.
import { useEffect, useRef } from 'react';
import { PspCheckout, VERSION } from '@qubiq-psp/react';
import type { CheckoutFrameProps, WidgetInfo } from './types';

export const widgetInfo: WidgetInfo = {
  variant: 'sdk',
  label: `@qubiq-psp/react ${VERSION}`,
  description:
    'This build shows the payment page with <PspCheckout> of @qubiq-psp/react: the component checks the origin and the window of each message and calls onReady, onStatusChange, onPaid, onExpired and onError.',
};

export function CheckoutFrame({ url, checkoutOrigin, onEvent, title = 'Payment' }: CheckoutFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  // <PspCheckout> has no callback for `resize`: it sets the iframe height itself. The log shows the height it set.
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.round(element.getBoundingClientRect().height);
      if (height > 0 && height !== last) {
        last = height;
        handler.current({ type: 'resize', fields: { height, measured: 'iframe height set by <PspCheckout>' } });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [url]);

  return (
    <div ref={box}>
      <PspCheckout
        url={url}
        checkoutOrigin={checkoutOrigin}
        title={title}
        minHeight={640}
        onReady={(e) =>
          handler.current({
            type: 'ready',
            fields: { status: e.status, invoiceId: e.invoiceId, linkExpiresAt: e.linkExpiresAt },
          })
        }
        onStatusChange={(status, e) =>
          e.type === 'status' &&
          handler.current({ type: 'status', fields: { status, invoiceId: e.invoiceId, paidAt: e.paidAt } })
        }
        onPaid={(e) => handler.current({ type: 'paid', fields: { status: e.status } })}
        onExpired={(e) => handler.current({ type: 'expired', fields: { status: e.status } })}
        onError={(code) => handler.current({ type: 'error', fields: { code } })}
      />
    </div>
  );
}
