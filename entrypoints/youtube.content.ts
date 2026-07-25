/**
 * ISOLATED world. PLAN.md §5.
 *
 * Ha accesso alle `chrome.*` API ma non alle variabili di pagina. Fa tre cose:
 *  1. chiede al service worker lo stato risolto per questa scheda;
 *  2. lo comunica al MAIN world e lo scrive nella cache sincrona, così il
 *     prossimo `document_start` di questa scheda decide senza attendere;
 *  3. riporta al worker le statistiche che il MAIN world gli manda.
 *
 * La UI nel player (RF-3) e l'overlay (RF-4) sono Fase 2.
 */

import { createIsolatedBridge } from '../lib/bridge';
import { logger } from '../lib/logger';
import { isBroadcast, sendMessage } from '../lib/messaging';
import { YT_EVENTS } from '../lib/selectors';
import { readCachedDecision, writeCachedDecision } from '../lib/sync-cache';

import '../lib/ui/ui.css';
import { createOverlay } from '../lib/ui/overlay';
import { createPlayerButton } from '../lib/ui/player-button';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://music.youtube.com/*'],
  runAt: 'document_start',
  allFrames: true,

  main(): void {
    const controller = new AbortController();
    const { signal } = controller;

    /** Con quale decisione il MAIN world ha effettivamente avviato la pagina. */
    const loadedWith = readCachedDecision();

    const currentThumbnail = '';
    let currentIsLive = false;

    const playerButton = createPlayerButton({
      root: document,
      signal,
      onClick: () => {
        void sendMessage({ type: 'TOGGLE_TAB' });
      },
    });

    const overlay = createOverlay({
      root: document,
      signal,
    });

    const bridge = createIsolatedBridge((message) => {
      switch (message.kind) {
        case 'hello':
          break;
        case 'filter-applied':
          currentIsLive = false;
          // Se arriva thumbnail usiamola, ma in Piano C SABR potrebbe mancare, aggiorniamo l'overlay
          overlay.updateState(readCachedDecision(), currentIsLive, currentThumbnail);
          void sendMessage({
            type: 'REPORT_STATS',
            stats: { estimatedBytesSaved: message.bytesSaved },
          });
          break;
        case 'filter-skipped':
          currentIsLive = message.isLive ?? false;
          overlay.updateState(readCachedDecision(), currentIsLive, currentThumbnail);
          if (message.isLive) void sendMessage({ type: 'REPORT_LIVE' });
          break;
      }
    }, signal);

    const apply = (enabled: boolean, mode: import('../lib/types').Mode): void => {
      writeCachedDecision(enabled, mode);
      bridge.send({ kind: 'set-enabled', enabled });

      playerButton.updateState(enabled);
      overlay.updateState(enabled, currentIsLive, currentThumbnail);

      // Il MAIN world ha già deciso a `document_start`. Se la decisione è
      // cambiata, il player ha già negoziato lo stream sbagliato: serve un
      // ricaricamento. È il fallback documentato del rischio E; il toggle
      // senza reload è Fase 2 (`applyModeChange`).
      if (enabled !== loadedWith) reloadPreservingPosition();
    };

    void (async () => {
      try {
        const { state, settings } = await sendMessage({ type: 'GET_STATE' });
        apply(state.enabled, settings.mode);
      } catch (error) {
        logger.warn('stato non disponibile, la pagina resta come si è caricata', error);
      }
    })();

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isBroadcast(message)) return;
      apply(message.state.enabled, message.settings.mode);
    });

    // Navigazione SPA: lo stato per-scheda non cambia, ma il video sì.
    window.addEventListener(
      YT_EVENTS.navigateFinish,
      () => {
        logger.debug('navigazione SPA completata');
      },
      { signal },
    );

    window.addEventListener('pagehide', () => controller.abort(), { signal });
  },
});

/**
 * Ricarica preservando la posizione di riproduzione (issue #56).
 * Non chiama mai `play()`: il bug #6 dell'originale era esattamente questo.
 */
function reloadPreservingPosition(): void {
  try {
    const url = new URL(window.location.href);
    if (url.pathname === '/watch') {
      const video = document.querySelector('video');
      const seconds = video ? Math.floor(video.currentTime) : 0;
      if (seconds > 1) url.searchParams.set('t', `${seconds}s`);
    }
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}
