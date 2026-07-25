/**
 * Service worker. PLAN.md §6.
 *
 * ★ Tutti i listener al TOP LEVEL e sincroni: in MV3 il worker viene terminato,
 *   e alla riattivazione gli eventi arrivano prima che un listener registrato
 *   dentro una callback asincrona esista (anti-pattern dell'originale).
 *
 * ★ NESSUNA richiesta di rete. È solo una macchina a stati.
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
  browser.runtime.onInstalled.addListener(() => {
    void sweepClosedTabs();
  });

  browser.runtime.onStartup.addListener(() => {
    void sweepClosedTabs();
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) void toggleTab(tab.id, tab.url);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-audio-only') return;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) await toggleTab(tab.id, tab.url);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void removeTabState(tabId);
  });

  // ★ Correzione a PLAN.md §6: NON registriamo `tabs.onUpdated` né
  //   `tabs.onActivated`.
  //
  //   Il piano prevedeva `tabs.onUpdated.addListener(cb, { urls, properties })`,
  //   ma il secondo parametro di filtro è un'estensione solo-Firefox: su Chrome
  //   `tabs.onUpdated` non accetta filtri, quindi lì il worker si sveglierebbe a
  //   ogni navigazione di ogni scheda — esattamente ciò che il piano voleva
  //   evitare.
  //
  //   Non servono: il badge è per-scheda e il browser lo ricorda, quindi
  //   `onActivated` non ha nulla da aggiornare; e ogni caricamento di pagina
  //   YouTube manda già `GET_STATE`, che passa da `resolve()` e applica il
  //   badge. Risultato: meno risvegli del worker di quanti ne avrebbe avuti il
  //   listener filtrato, e nessuna API non portabile.

  browser.runtime.onMessage.addListener(handleMessage);

  // Le impostazioni cambiano → tutte le schede YouTube vanno riallineate.
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'sync') return;
    void broadcastToAllTabs();
  });
});

/**
 * Unico punto di dispatch (§8). Restituisce `true` solo quando risponderà in
 * modo asincrono, come richiede `runtime.onMessage`.
 */
function handleMessage(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  if (!isMessage(message)) return false;

  // In Fase 1 ogni messaggio del protocollo nasce in un content script, quindi
  // la scheda è sempre nota. Il popup (Fase 2) non passa da qui: dovrà indicare
  // il `tabId` esplicitamente, perché per lui `sender.tab` è `undefined`.
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
      // Contatore locale (§12)
      void recordSchemaViolation(message.violation);
      logger.warn('violazione di schema', message.violation);
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
  logger.debug(`toggle scheda ${tabId}: ${current} → ${resolved.state.enabled}`, next);
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
          ? 'YouTube Audio Only — disattivata nelle opzioni'
          : enabled
            ? 'YouTube Audio Only — attiva in questa scheda'
            : 'YouTube Audio Only — disattivata in questa scheda',
    });
  } catch {
    /* la scheda può essere già chiusa */
  }
}

async function notifyTab(tabId: number, resolved: ResolvedState): Promise<void> {
  const broadcast: Broadcast = { type: 'STATE_CHANGED', ...resolved };
  try {
    await browser.tabs.sendMessage(tabId, broadcast);
  } catch {
    // Nessun content script in ascolto (pagina non-YouTube o non ancora
    // caricata). Non è un errore.
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
