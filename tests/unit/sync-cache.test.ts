/**
 * @vitest-environment happy-dom
 *
 * La cache sincrona è il meccanismo che permette al MAIN world di decidere a
 * `document_start` senza `await`. Se sbaglia, o si perde il player response
 * inline, o si filtra una scheda che l'utente non aveva attivato.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCachedDecision, readCachedDecision, writeCachedDecision } from '../../lib/sync-cache';

describe('cache sincrona della decisione', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ senza informazione la risposta è NO: YouTube funziona normalmente', () => {
    expect(readCachedDecision()).toBe(false);
  });

  it('la decisione per-scheda vince', () => {
    writeCachedDecision(true, 'per-tab');
    expect(readCachedDecision()).toBe(true);

    writeCachedDecision(false, 'per-tab');
    expect(readCachedDecision()).toBe(false);
  });

  it('★ la decisione per-scheda vince anche sulla modalità always', () => {
    // L'utente ha spento esplicitamente questa scheda: va rispettato.
    writeCachedDecision(false, 'always');
    expect(readCachedDecision()).toBe(false);
  });

  it('la modalità always decide per una scheda mai toccata', () => {
    // Come se un\'altra scheda avesse scritto la modalità in localStorage.
    localStorage.setItem('ytao:mode', 'always');
    expect(readCachedDecision()).toBe(true);
  });

  it('le modalità off e per-tab non attivano una scheda mai toccata', () => {
    localStorage.setItem('ytao:mode', 'off');
    expect(readCachedDecision()).toBe(false);
    localStorage.setItem('ytao:mode', 'per-tab');
    expect(readCachedDecision()).toBe(false);
  });

  it('clearCachedDecision riporta la scheda a "non deciso"', () => {
    localStorage.setItem('ytao:mode', 'always');
    writeCachedDecision(false, 'always');
    expect(readCachedDecision()).toBe(false);

    clearCachedDecision();
    expect(readCachedDecision()).toBe(true); // torna a decidere la modalità
  });

  it('ignora valori spazzatura nella chiave per-scheda', () => {
    sessionStorage.setItem('ytao:tab-enabled', 'forse');
    expect(readCachedDecision()).toBe(false);
  });

  it('★ non lancia se lo storage è vietato (modalità privacy)', () => {
    const boom = (): never => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => readCachedDecision()).not.toThrow();
    expect(readCachedDecision()).toBe(false);
    expect(() => writeCachedDecision(true, 'always')).not.toThrow();
    expect(() => clearCachedDecision()).not.toThrow();
  });
});
