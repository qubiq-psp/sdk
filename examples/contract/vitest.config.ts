import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The machine is shared with other psp runs: two workers are enough
    maxWorkers: 2,
  },
});
