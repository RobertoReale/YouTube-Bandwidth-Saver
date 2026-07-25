/**
 * MAIN world, `document_start`. PLAN.md §5.
 *
 * This script has no access to `chrome.*` APIs. Initial decision comes
 * from synchronous cache (`lib/sync-cache.ts`), then gets corrected by ISOLATED
 * world via bridge.
 *
 * Mechanism:
 *  - **Forced minimal quality** (plan C, `quality.ts`) — uses YouTube's player API
 *    to force the lowest quality (144p). Reduces bandwidth without modifying network
 *    requests, avoiding YouTube's anti-adblock detection.
 */

import { createMainBridge } from '../lib/bridge';
import { logger } from '../lib/logger';
import { createQualityEnforcer } from '../lib/player/quality';
import { YT_EVENTS } from '../lib/selectors';
import { readCachedDecision } from '../lib/sync-cache';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://music.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,

  main(): void {
    // 1. Synchronous decision. Default `false`: without info, normal YouTube.
    let enabled = readCachedDecision();

    /** Lifetime of all listeners and observers in this frame (§11). */
    const lifetime = new AbortController();

    // Diagnostics: exists ONLY in development builds.
    const trace: unknown[] = [];
    if (import.meta.env.DEV) {
      Object.defineProperty(window, '__ytAudioOnlyDebug', {
        configurable: true,
        get: () => ({ enabled, trace }),
      });
    }

    // 2. Bridge with ISOLATED world holding true state.
    let onEnabledChange: (next: boolean) => void = () => {};
    const bridge = createMainBridge((next) => {
      enabled = next;
      onEnabledChange(next);
    }, lifetime.signal);

    // 3. Plan C: forcing minimal quality.
    const enforcer = createQualityEnforcer(
      {
        root: document,
        events: window,
        signal: lifetime.signal,
        navigationEvents: [YT_EVENTS.navigateFinish],
        onOutcome: (outcome, trigger) => {
          logger.debug(`quality (${trigger}):`, outcome);
          if (import.meta.env.DEV) trace.push({ source: 'quality', trigger, ...outcome });
        },
      },
      enabled,
    );

    enforcer.apply('startup');
    onEnabledChange = (next) => enforcer.setEnabled(next);

    window.addEventListener('pagehide', () => lifetime.abort(), { signal: lifetime.signal });
  },
});
