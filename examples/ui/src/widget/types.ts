// What the payment widget tells the screen, the same for both builds. These types are the UI's own: the plain build
// must not take anything from @qubiq-psp/react.

/** Statuses of an invoice the payment page reports (gateway docs 20.9). */
export type InvoiceStatus =
  'active' | 'partially_paid' | 'paid' | 'overpaid' | 'expired' | 'expired_partial' | 'cancelled';

/**
 * One event of the widget for the log:
 * - `ready`, `status`, `resize`, `error` — the messages of the payment page (gateway docs 20.9);
 * - `paid`, `expired` — once per link, when the status first becomes paid/overpaid or expired/expired_partial
 *   (as `onPaid`/`onExpired` of `<PspCheckout>`);
 * - `rejected` — a `psp-checkout` message that failed a check: another origin, another window or a wrong shape
 *   (the plain build only; the SDK drops them silently).
 */
export interface WidgetEvent {
  type: 'ready' | 'status' | 'paid' | 'expired' | 'resize' | 'error' | 'rejected';
  fields: Record<string, unknown>;
}

export interface CheckoutFrameProps {
  /** The signed link from `POST /api/invoices/{invoiceId}/checkout-link`. */
  url: string;
  /** `checkoutUrl` of `GET /api/config`: the link must have this origin, and only its messages are accepted. */
  checkoutOrigin: string;
  onEvent: (event: WidgetEvent) => void;
  /** Accessible name of the iframe. */
  title?: string;
}

/** How this build shows the widget, for the header and the widget panel. */
export interface WidgetInfo {
  variant: 'sdk' | 'plain';
  label: string;
  description: string;
}
