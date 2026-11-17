import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The live check runs only through pnpm test:live
    exclude: [...configDefaults.exclude, 'test/live/**'],
    environment: 'node',
    testTimeout: 15_000,
    // The machine is shared with other psp runs: two workers are enough for this suite
    maxWorkers: 2,
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'] },
  },
});
