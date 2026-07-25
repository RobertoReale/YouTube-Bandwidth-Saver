import { browser } from 'wxt/browser';
import { logger } from './logger';
import type { SchemaViolation } from './types';

const KEY = 'schema_violations';

export async function recordSchemaViolation(violation: SchemaViolation): Promise<void> {
  try {
    const data = await browser.storage.local.get(KEY);
    const violations = (data[KEY] || []) as SchemaViolation[];

    // Teniamo solo le ultime 50 per evitare di riempire lo storage
    violations.push(violation);
    if (violations.length > 50) {
      violations.shift();
    }

    await browser.storage.local.set({ [KEY]: violations });
    logger.warn('SchemaViolation registrata in locale:', violation);
  } catch (err) {
    logger.error('Errore durante il salvataggio della violazione', err);
  }
}

export async function getViolationCount(): Promise<number> {
  try {
    const data = await browser.storage.local.get(KEY);
    const violations = (data[KEY] || []) as SchemaViolation[];
    return violations.length;
  } catch {
    return 0;
  }
}
