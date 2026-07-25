/**
 * PLAN.md §6/§11 — nessun `console.log` in produzione.
 *
 * `import.meta.env.DEV` è una costante statica sostituita da Vite in fase di
 * build: nelle build di release il corpo di queste funzioni diventa
 * irraggiungibile e il tree-shaking lo elimina, insieme alle stringhe dei
 * messaggi.
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
   * Anche gli errori sono silenziosi in produzione: l'estensione è fail-open,
   * un errore nostro non deve inquinare la console dell'utente. Il segnale
   * strutturato per la diagnosi è `SchemaViolation` (§12), non la console.
   */
  error(...args: Args): void {
    if (import.meta.env.DEV) console.error(PREFIX, ...args);
  },
};
