/**
 * SYNCHRONOUS cache of decision "should this page be filtered?".
 *
 * The problem: at `document_start` MAIN world must decide before YouTube inline
 * script assigns `ytInitialPlayerResponse`. Single source of truth is service
 * worker (§7), but querying it is async, and `PLAN.md` §11 forbids
 * any `await` prior to hook installation.
 *
 * The solution: `sessionStorage` and `localStorage` are readable
 * synchronously, and ISOLATED content script shares page origin.
 *
 *  - `sessionStorage` is per-browsing-context → exact semantics for per-tab
 *    state of RF-2, surviving same-tab reloads.
 *  - `localStorage` is shared across tabs → only needed for `always`
 *    mode, where decision does not depend on tab.
 *
 * Service worker remains single source of truth: these values are a cache
 * that only serves to win race against inline script. If they diverge,
 * ISOLATED world corrects cache as soon as worker responds (§8).
 *
 * Security note (§13): page can read and write these values. Maximum
 * damage is turning audio-only mode on or off, which is not a privilege:
 * no sensitive data passes through here, and decision is reconciled
 * with worker on every load anyway.
 */

import type { Mode } from './types';

const TAB_KEY = 'ytao:tab-enabled';
const MODE_KEY = 'ytao:mode';

/** Reads without ever throwing: in some privacy modes storage is restricted. */
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
    /* no consequence: cache is lost, not correctness */
  }
}

/**
 * Synchronous decision to use at `document_start`.
 * Default `false`: in absence of information, normal YouTube behavior.
 */
export function readCachedDecision(): boolean {
  const perTab = read(() => sessionStorage, TAB_KEY);
  if (perTab === '1') return true;
  if (perTab === '0') return false;
  // No decision for this tab: only `always` mode justifies filtering.
  return read(() => localStorage, MODE_KEY) === 'always';
}

/** Called by ISOLATED world when worker has responded. */
export function writeCachedDecision(enabled: boolean, mode: Mode): void {
  write(() => sessionStorage, TAB_KEY, enabled ? '1' : '0');
  write(() => localStorage, MODE_KEY, mode);
}

export function clearCachedDecision(): void {
  write(() => sessionStorage, TAB_KEY, null);
}
