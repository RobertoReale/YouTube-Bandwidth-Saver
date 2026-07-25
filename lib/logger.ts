/**
 * PLAN.md §6/§11 — no `console.log` in production.
 *
 * `import.meta.env.DEV` is a static constant replaced by Vite during
 * build: in release builds the body of these functions becomes
 * unreachable and tree-shaking removes it, along with message strings.
 */

const PREFIX = '[yt-audio-only]';

type Args = readonly unknown[];

export const logger = {
  debug(...args: Args): void {
    if (import.meta.env.DEV) console.debug(PREFIX, ...args);
  },
  info(...args: Args): void {
    if (import.meta.env.DEV) console.info(PREFIX, ...args);
  },
  warn(...args: Args): void {
    if (import.meta.env.DEV) console.warn(PREFIX, ...args);
  },
  /**
   * Errors are also silent in production: extension is fail-open,
   * our error must not pollute user's console. Structured signal
   * for diagnosis is `SchemaViolation` (§12), not console.
   */
  error(...args: Args): void {
    if (import.meta.env.DEV) console.error(PREFIX, ...args);
  },
};
