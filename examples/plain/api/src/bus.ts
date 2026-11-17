import { EventEmitter } from 'node:events';
import type { ReceivedWebhookItem, RequestLogItem } from './types.ts';

/** What the SSE stream sends: a new request-log entry or a new received webhook. */
export type StreamEvent = { type: 'request'; item: RequestLogItem } | { type: 'webhook'; item: ReceivedWebhookItem };

export class EventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0); // every open UI tab is a listener
  }

  emit(event: StreamEvent): void {
    this.#emitter.emit('event', event);
  }

  subscribe(listener: (event: StreamEvent) => void): () => void {
    this.#emitter.on('event', listener);
    return () => this.#emitter.off('event', listener);
  }
}
