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
    },
  },
});
