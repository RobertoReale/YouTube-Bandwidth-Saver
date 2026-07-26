/**
 * Service worker.
 *
 * ★ All listeners registered synchronously at TOP LEVEL: in MV3 worker gets terminated,
 *   and upon reactivation events arrive before any listener registered
 *   inside an async callback exists (anti-pattern in original extension).
 *
 * ★ NO network requests. Pure state machine.
 */

import type { Browser } from 'wxt/browser';
import { logger } from '../lib/logger';
import { type Broadcast, isMessage, type ResolvedState } from '../lib/messaging';
import { SUPPORTED_HOSTS } from '../lib/selectors';
import { getSettings } from '../lib/settings';
import {
  getTabState,
  removeTabState,
  resolveEnabled,
  setTabState,
  sweepClosedTabs,
} from '../lib/state';
import { recordSchemaViolation } from '../lib/telemetry';

const MATCHES = SUPPORTED_HOSTS.map((host) => `*://${host}/*`);

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    void sweepClosedTabs();
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onStartup.addListener(() => {
    void sweepClosedTabs();
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) {
      void (async () => {
        const settings = await getSettings();
        if (settings.mode !== 'per-tab') {
          await browser.runtime.openOptionsPage();
          return;
        }

        const url = tab.url;
        const isSupported =
          url &&
          SUPPORTED_HOSTS.some((host) => {
            try {
              return new URL(url).hostname === host;
            } catch {
              return false;
            }
          });

        if (isSupported) {
          await toggleTab(tab.id!, tab.url);
        } else {
          await browser.runtime.openOptionsPage();
        }
      })();
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-audio-only') return;
    void (async () => {
      const settings = await getSettings();
      if (settings.mode !== 'per-tab') return;
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) await toggleTab(tab.id, tab.url);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void removeTabState(tabId);
  });



  browser.runtime.onMessage.addListener(handleMessage);

  // Settings change → all YouTube tabs must re-align.
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'sync') return;
    void broadcastToAllTabs();
  });
});

/**
 * Single dispatch point. Returns `true` only when responding
 * asynchronously as required by `runtime.onMessage`.
 */
function handleMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  if (!isMessage(message)) return false;

  // In Phase 1 every protocol message originates from a content script, so
  // tab is always known. Popup (Phase 2) does not come through here: it provides
  // `tabId` explicitly because `sender.tab` is `undefined` for popups.
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  const url = sender.tab?.url;

  switch (message.type) {
    case 'GET_STATE':
      void resolve(tabId, url).then(sendResponse);
      return true;

    case 'TOGGLE_TAB':
      void toggleTab(tabId, url).then(sendResponse);
      return true;

    case 'REPORT_STATS':
      void accumulateBytes(tabId, message.stats.estimatedBytesSaved ?? 0);
      return false;

    case 'REPORT_LIVE':
      void setTabState(tabId, { isLive: true });
      return false;

    case 'REPORT_SCHEMA_VIOLATION':
      // Local counter
      void recordSchemaViolation(message.violation);
      logger.warn('schema violation', message.violation);
      return false;
  }
}

async function resolve(tabId: number, url: string | undefined): Promise<ResolvedState> {
  const [settings, tabState] = await Promise.all([getSettings(), getTabState(tabId)]);
  const enabled = resolveEnabled(settings.mode, tabState, settings, url);
  await applyBadge(tabId, enabled, settings.mode);
  return { state: { ...tabState, enabled }, settings };
}

async function toggleTab(tabId: number, url: string | undefined): Promise<ResolvedState> {
  const [settings, tabState] = await Promise.all([getSettings(), getTabState(tabId)]);
  const current = resolveEnabled(settings.mode, tabState, settings, url);
  const next = await setTabState(tabId, { enabled: !current, lastAppliedAt: Date.now() });
  const resolved = await resolve(tabId, url);
  logger.debug(`toggle tab ${tabId}: ${current} → ${resolved.state.enabled}`, next);
  await notifyTab(tabId, resolved);
  return resolved;
}

async function accumulateBytes(tabId: number, bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const current = await getTabState(tabId);
  await setTabState(tabId, { bytesSaved: current.bytesSaved + bytes });
}

async function applyBadge(tabId: number, enabled: boolean, mode: string): Promise<void> {
  try {
    await browser.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#0f9d58' });
    await browser.action.setTitle({
      tabId,
      title:
        mode === 'off'
          ? 'YouTube Bandwidth Saver — disabled in options'
          : enabled
            ? 'YouTube Bandwidth Saver — active in this tab'
            : 'YouTube Bandwidth Saver — disabled in this tab',
    });
  } catch {
    /* tab might already be closed */
  }
}

async function notifyTab(tabId: number, resolved: ResolvedState): Promise<void> {
  const broadcast: Broadcast = { type: 'STATE_CHANGED', ...resolved };
  try {
    await browser.tabs.sendMessage(tabId, broadcast);
  } catch {
    // No content script listening (non-YouTube page or not yet loaded).
    // Not an error.
  }
}

async function broadcastToAllTabs(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: MATCHES });
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return;
        await notifyTab(tab.id, await resolve(tab.id, tab.url));
      }),
    );
  } catch {
    /* fail-open */
  }
}
