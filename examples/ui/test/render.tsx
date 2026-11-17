import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { App, createQueryClient } from '@/app';
import { routes } from '@/routes';

/** The whole app at one address, with a fresh cache. */
export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  const utils = render(<App router={router} queryClient={queryClient} />);
  return { ...utils, router, queryClient };
}

type Listener = (event: MessageEvent<string>) => void;

/** EventSource for jsdom: records the URL and lets a test send events. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data: unknown): void {
    if (type === 'ready') this.readyState = FakeEventSource.OPEN;
    for (const l of this.listeners.get(type) ?? []) l(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
