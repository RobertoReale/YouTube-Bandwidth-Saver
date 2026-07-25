import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // Files that need DOM declare it with a comment
    // `@vitest-environment happy-dom` at the top: `environmentMatchGlobs` is
    // deprecated and a single global environment would slow down pure tests.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['lib/**/*.ts'],
      // PLAN.md §10: 100% on the two pure modules. No numeric target for the rest.
      thresholds: {
        'lib/player/format-filter.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'lib/player/response-schema.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
