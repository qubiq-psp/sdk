import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // The machine is shared with other runs: two workers are enough
    maxWorkers: 2,
    minWorkers: 1,
  },
});
