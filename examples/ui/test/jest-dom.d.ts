// The jest-dom matchers on vitest's `expect` (test/setup.ts extends it at run time). Declared here because the
// augmentation of '@testing-library/jest-dom/vitest' targets whichever vitest copy that package resolves.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/* eslint-disable @typescript-eslint/no-empty-object-type -- declaration merging adds the matchers */
declare module 'vitest' {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
