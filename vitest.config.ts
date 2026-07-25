import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // I file che hanno bisogno del DOM lo dichiarano con un commento
    // `@vitest-environment happy-dom` in testa: `environmentMatchGlobs` è
    // deprecato e un solo ambiente globale rallenterebbe i test puri.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['lib/**/*.ts'],
      // PLAN.md §10: 100% sui due moduli puri. Sul resto nessun obiettivo numerico.
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
