/**
 * Per-tab state.
 * (a single global boolean for all tabs, open since 2017).
 *
 * `storage.session` does not touch disk, resets on browser restart
 * (correct semantics for a per-tab toggle), and has no quota limits like
 * `sync`. MV3 worker gets terminated: state cannot be held in module variable.
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
    /* fail-open: state remains unchanged */
  }
  return next;
}

export async function removeTabState(tabId: number): Promise<void> {
  try {
    await browser.storage.session.remove(key(tabId));
  } catch {
    /* nothing to do */
  }
}

/**
 * Sweep: compares stored keys against actually open tabs.
 * Needed because `tabs.onRemoved` isn't fired if worker was sleeping when tab
 * was closed.
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
 * Decides if a tab should be filtered, combining mode and per-tab state.
 * Single point where this decision is made.
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
