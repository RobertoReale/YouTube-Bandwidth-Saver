/**
 * PLAN.md §7 — stato per-scheda. Risolve la issue #3 dell'originale
 * (un booleano globale per tutte le schede, aperta dal 2017).
 *
 * `storage.session` non tocca il disco, si azzera al riavvio del browser
 * (semantica corretta per un toggle per-scheda) e non ha i limiti di quota
 * di `sync`. Il worker MV3 viene terminato: non si può tenere lo stato in una
 * variabile di modulo.
 */

import { browser } from 'wxt/browser';
import type { Mode, Settings, TabState } from './types';

const PREFIX = 'tab:';

export function emptyTabState(): TabState {
  return { enabled: false, videoId: null, isLive: false, bytesSaved: 0, lastAppliedAt: 0 };
}

function key(tabId: number): string {
  return `${PREFIX}${tabId}`;
}

function normalize(raw: unknown): TabState {
  if (typeof raw !== 'object' || raw === null) return emptyTabState();
  const input = raw as Record<string, unknown>;
  const base = emptyTabState();
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    videoId: typeof input.videoId === 'string' ? input.videoId : base.videoId,
    isLive: typeof input.isLive === 'boolean' ? input.isLive : base.isLive,
    bytesSaved: typeof input.bytesSaved === 'number' ? input.bytesSaved : base.bytesSaved,
    lastAppliedAt:
      typeof input.lastAppliedAt === 'number' ? input.lastAppliedAt : base.lastAppliedAt,
  };
}

export async function getTabState(tabId: number): Promise<TabState> {
  try {
    const stored = await browser.storage.session.get(key(tabId));
    return normalize(stored[key(tabId)]);
  } catch {
    return emptyTabState();
  }
}

export async function setTabState(tabId: number, patch: Partial<TabState>): Promise<TabState> {
  const next = { ...(await getTabState(tabId)), ...patch };
  try {
    await browser.storage.session.set({ [key(tabId)]: next });
  } catch {
    /* fail-open: lo stato resta quello precedente */
  }
  return next;
}

export async function removeTabState(tabId: number): Promise<void> {
  try {
    await browser.storage.session.remove(key(tabId));
  } catch {
    /* niente da fare */
  }
}

/**
 * Sweep: confronta le chiavi salvate con le schede realmente aperte.
 * Serve perché `tabs.onRemoved` non arriva se il worker dormiva quando la
 * scheda è stata chiusa.
 */
export async function sweepClosedTabs(): Promise<number> {
  try {
    const [stored, tabs] = await Promise.all([
      browser.storage.session.get(null),
      browser.tabs.query({}),
    ]);
    const alive = new Set(tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined));
    const stale = Object.keys(stored).filter((storedKey) => {
      if (!storedKey.startsWith(PREFIX)) return false;
      const tabId = Number.parseInt(storedKey.slice(PREFIX.length), 10);
      return !Number.isNaN(tabId) && !alive.has(tabId);
    });
    if (stale.length > 0) await browser.storage.session.remove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

/**
 * Decide se una scheda va filtrata, combinando modalità e stato per-scheda.
 * È l'unico punto in cui questa decisione viene presa (§7: una sola fonte
 * di verità, i content script non la derivano mai da soli).
 */
export function resolveEnabled(
  mode: Mode,
  tabState: TabState,
  settings: Settings,
  url: string | undefined,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (settings.autoEnableOnMusic && isMusicUrl(url)) return true;
  return tabState.enabled;
}

export function isMusicUrl(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    return new URL(url).hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}
