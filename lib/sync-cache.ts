/**
 * Cache SINCRONA della decisione "questa pagina va filtrata?".
 *
 * Il problema: a `document_start` il MAIN world deve decidere prima che lo script
 * inline di YouTube assegni `ytInitialPlayerResponse`. La fonte di verità è il
 * service worker (§7), ma interrogarlo è asincrono, e `PLAN.md` §11 vieta
 * qualunque `await` prima dell'installazione degli hook.
 *
 * La soluzione: `sessionStorage` e `localStorage` sono leggibili in modo
 * sincrono, e il content script ISOLATED condivide l'origine della pagina.
 *
 *  - `sessionStorage` è per-contesto-di-navigazione → semantica esatta per lo
 *    stato per-scheda di RF-2, e sopravvive ai reload della stessa scheda.
 *  - `localStorage` è condiviso fra le schede → serve solo per la modalità
 *    `always`, dove la decisione non dipende dalla scheda.
 *
 * Il service worker resta l'unica fonte di verità: questi valori sono una cache
 * che serve solo a vincere la corsa contro lo script inline. Se divergono,
 * l'ISOLATED world corregge la cache appena il worker risponde (§8).
 *
 * Nota di sicurezza (§13): la pagina può leggere e scrivere questi valori. Il
 * danno massimo è attivare o disattivare la modalità audio-only, che non è un
 * privilegio: nessun dato sensibile passa da qui, e la decisione viene comunque
 * riconciliata con il worker a ogni caricamento.
 */

import type { Mode } from './types';

const TAB_KEY = 'ytao:tab-enabled';
const MODE_KEY = 'ytao:mode';

/** Legge senza mai lanciare: in alcune modalità privacy lo storage è vietato. */
function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* nessuna conseguenza: si perde solo la cache, non la correttezza */
  }
}

/**
 * La decisione sincrona da usare a `document_start`.
 * Default `false`: in assenza di informazione, YouTube funziona normalmente.
 */
export function readCachedDecision(): boolean {
  const perTab = read(() => sessionStorage, TAB_KEY);
  if (perTab === '1') return true;
  if (perTab === '0') return false;
  // Nessuna decisione per questa scheda: solo `always` giustifica il filtro.
  return read(() => localStorage, MODE_KEY) === 'always';
}

/** Chiamata dall'ISOLATED world quando il worker ha detto la sua. */
export function writeCachedDecision(enabled: boolean, mode: Mode): void {
  write(() => sessionStorage, TAB_KEY, enabled ? '1' : '0');
  write(() => localStorage, MODE_KEY, mode);
}

export function clearCachedDecision(): void {
  write(() => sessionStorage, TAB_KEY, null);
}
