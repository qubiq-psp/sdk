import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// Screens are tested with the plain widget; each widget has its own test that imports its file directly.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'virtual:checkout-frame', replacement: src('widget/checkout-frame.plain.tsx') },
      { find: /^@\//, replacement: src('') },
    ],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    // The machine is shared with other runs: two workers are enough
    maxWorkers: 2,
    css: false,
  },
});
