import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { components } from '@psp-examples/contract/types';
import { invalidateOps } from './hooks';

type RequestLogItem = components['schemas']['RequestLogItem'];
type ReceivedWebhookItem = components['schemas']['ReceivedWebhookItem'];

export type StreamState = 'connecting' | 'open' | 'closed' | 'unsupported';

type Listener<T> = (item: T) => void;

/** The live state of `GET /api/stream` and its subscribers, outside React. */
class StreamHub {
  state: StreamState = 'connecting';
  private readonly stateListeners = new Set<() => void>();
  private readonly requestListeners = new Set<Listener<RequestLogItem>>();
  private readonly webhookListeners = new Set<Listener<ReceivedWebhookItem>>();

  setState(state: StreamState): void {
    if (this.state === state) return;
    this.state = state;
    for (const l of this.stateListeners) l();
  }

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  onRequest(listener: Listener<RequestLogItem>): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onWebhook(listener: Listener<ReceivedWebhookItem>): () => void {
    this.webhookListeners.add(listener);
    return () => this.webhookListeners.delete(listener);
  }

  emitRequest(item: RequestLogItem): void {
    for (const l of this.requestListeners) l(item);
  }

  emitWebhook(item: ReceivedWebhookItem): void {
    for (const l of this.webhookListeners) l(item);
  }
}

export const streamHub = new StreamHub();

export function useStreamState(): StreamState {
  return useSyncExternalStore(streamHub.subscribeState, () => streamHub.state);
}

function parse(event: MessageEvent<string>): unknown {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

/**
 * Listens to the SSE stream of the backend (`GET /api/stream`): a new request-log entry refreshes the log, a received
 * webhook refreshes the receiver log and whatever it may have changed (the invoice, deliveries, the receiver's
 * `failNext`). EventSource reconnects by itself (`retry: 3000`); there is no replay, so a reconnect refetches the
 * lists.
 */
export function useStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      streamHub.setState('unsupported');
      return undefined;
    }
    const source = new EventSource('/api/stream');
    let connected = false;
    streamHub.setState('connecting');

    source.addEventListener('ready', () => {
      streamHub.setState('open');
      if (connected) invalidateOps(qc, 'listRequestLog', 'listReceivedWebhooks');
      connected = true;
    });
    source.addEventListener('request', (e: MessageEvent<string>) => {
      const item = parse(e) as RequestLogItem | null;
      if (!item) return;
      streamHub.emitRequest(item);
      // An auto-refresh entry changes only the log views that show them
      void qc.invalidateQueries({
        queryKey: ['listRequestLog'],
        predicate: (q) => item.source !== 'poll' || (q.queryKey[2] as { source?: string } | null)?.source !== 'ui',
      });
    });
    source.addEventListener('webhook', (e: MessageEvent<string>) => {
      const item = parse(e) as ReceivedWebhookItem | null;
      if (!item) return;
      streamHub.emitWebhook(item);
      invalidateOps(
        qc,
        'listReceivedWebhooks',
        'getReceiverSettings',
        'getInvoice',
        'listInvoiceEvents',
        'listInvoices',
        'listDeliveries',
        'getDelivery',
        'getWebhookSettings',
      );
    });
    source.onerror = () => {
      streamHub.setState(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };
    return () => {
      source.close();
      streamHub.setState('closed');
    };
  }, [qc]);
}
