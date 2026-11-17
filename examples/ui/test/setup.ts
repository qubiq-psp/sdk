import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { server } from './msw';

// Extended here, not via '@testing-library/jest-dom/vitest': that entry imports `vitest` from its own place, which
// in this workspace can be another vitest copy (examples/contract uses vitest 3)
expect.extend(matchers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

// jsdom lacks these browser APIs that Radix and the screens touch
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;
Object.assign(Element.prototype, {
  scrollIntoView() {},
  hasPointerCapture: () => false,
  releasePointerCapture() {},
});
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
// No canvas in jsdom: the QR code is skipped, as the component does when drawing fails
HTMLCanvasElement.prototype.getContext = () => null;
