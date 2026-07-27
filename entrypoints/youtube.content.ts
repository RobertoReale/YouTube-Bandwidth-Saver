/**
 * ISOLATED world.
 *
 * Has access to `chrome.*` APIs but not page variables. Performs three tasks:
 *  1. requests resolved state for this tab from service worker;
 *  2. communicates it to MAIN world and writes to synchronous cache, so next
 *     `document_start` for this tab decides without waiting;
 *  3. reports stats back to worker that MAIN world sends it.
 *
 * Player UI and overlay are Phase 2.
 */

import { createIsolatedBridge } from '../lib/bridge';
import { logger } from '../lib/logger';
import { isBroadcast, sendMessage } from '../lib/messaging';
import { YT_EVENTS } from '../lib/selectors';
import { readCachedDecision, writeCachedDecision } from '../lib/sync-cache';

import '../lib/ui/ui.css';
import { createOverlay } from '../lib/ui/overlay';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://music.youtube.com/*'],
  runAt: 'document_start',
  allFrames: true,

  main(): void {
    const controller = new AbortController();
    const { signal } = controller;

    /** With which decision MAIN world actually started the page. */
    const loadedWith = readCachedDecision();

    // User requested to remove the in-player button.
    // They will use the extension popup instead.

    const overlay = createOverlay({
      root: document,
      signal,
    });

    const bridge = createIsolatedBridge((message) => {
      switch (message.kind) {
        case 'hello':
          break;
      }
    }, signal);

    const apply = (enabled: boolean, settings: import('../lib/types').Settings): void => {
      writeCachedDecision(enabled, settings.mode);
      bridge.send({ kind: 'set-enabled', enabled });

      overlay.updateState(enabled && settings.showOverlay);

      // MAIN world already decided at `document_start`. If decision
      // changed, player already negotiated wrong stream: reload needed.
      // Documented fallback for Risk E; toggle without reload is Phase 2 (`applyModeChange`).
      if (enabled !== loadedWith) reloadPreservingPosition();
    };

    void (async () => {
      try {
        const { state, settings } = await sendMessage({ type: 'GET_STATE' });
        apply(state.enabled, settings);
      } catch (error) {
        logger.warn('state unavailable, page stays as loaded', error);
      }
    })();

    const onBroadcast = (message: unknown): void => {
      if (!isBroadcast(message)) return;
      apply(message.state.enabled, message.settings);
    };
    // After an extension reload/update this script stays alive in the page but
    // orphaned: `browser.runtime` is gone. Fail silently instead of throwing and
    // skipping the listeners registered below.
    if (browser.runtime?.onMessage) {
      browser.runtime.onMessage.addListener(onBroadcast);
      signal.addEventListener('abort', () => {
        browser.runtime.onMessage?.removeListener(onBroadcast);
      });
    } else {
      logger.warn('extension context invalidated, broadcasts unavailable');
    }

    // SPA navigation: per-tab state does not change, but video does.
    window.addEventListener(
      YT_EVENTS.navigateFinish,
      () => {
        logger.debug('SPA navigation completed');
      },
      { signal },
    );

    window.addEventListener('pagehide', () => controller.abort(), { signal });
  },
});

/**
 * Reloads while preserving playback position (issue #56).
 * Never calls `play()`: original bug #6 was exactly this.
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
