/**
 * MAIN world, `document_start`. PLAN.md §5.
 *
 * ★ Absolute constraint (§11): no `await`, no async operation before
 *   `installHooks`. A single extra `await` and YouTube inline script
 *   has already assigned `ytInitialPlayerResponse`.
 *
 * This script has no access to `chrome.*` APIs. Initial decision comes
 * from synchronous cache (`lib/sync-cache.ts`), then gets corrected by ISOLATED
 * world via bridge.
 *
 * Two mechanisms, in order of preference:
 *
 *  1. **Forced minimal quality** (plan C, `quality.ts`) — main mechanism since
 *     YouTube uses SABR: server decides bytes, so the only lever is
 *     asking for the lowest quality. Reduces bandwidth, does not zero it out.
 *  2. **Format filter** (`format-filter.ts`) — remains installed as a
 *     fallback for clients still receiving direct track URLs, where
 *     it truly zeroes out video bytes. Disables itself if it sees SABR.
 */

import { createMainBridge, type MainToIsolated } from '../lib/bridge';
import { logger } from '../lib/logger';
import { filterPlayerResponse } from '../lib/player/format-filter';
import { installHooks } from '../lib/player/hooks';
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

    // Diagnostics: exists ONLY in development builds. `import.meta.env.DEV` is
    // replaced by Vite, so in production this block and the array feeding it
    // are eliminated by tree-shaking.
    const trace: unknown[] = [];
    if (import.meta.env.DEV) {
      Object.defineProperty(window, '__ytAudioOnlyDebug', {
        configurable: true,
        get: () => ({ enabled, trace }),
      });
    }

    // 2. Queue for reports emitted before bridge is ready.
    const pending: MainToIsolated[] = [];
    let send: (message: MainToIsolated) => void = (message) => {
      pending.push(message);
    };

    // 3. Hooks installed IMMEDIATELY, synchronously.
    installHooks({
      transform(input, source) {
        if (!enabled) {
          if (import.meta.env.DEV) trace.push({ source, skipped: 'disabled' });
          return input;
        }

        const result = filterPlayerResponse(input);

        if (import.meta.env.DEV) {
          trace.push({
            source,
            applied: result.applied,
            reason: result.reason,
            stats: result.stats,
            videoId: result.videoId,
            violations: result.violations,
            // What was actually left in response delivered to player.
            keptMimeTypes: mimeTypesOf(result.response),
          });
        }

        if (result.applied) {
          logger.debug(`${source}: -${result.stats.videoFormatsRemoved} video`, result.stats);
          send({
            kind: 'filter-applied',
            videoId: result.videoId ?? null,
            bytesSaved: result.stats.estimatedBytesSaved,
          });
        } else if (result.reason !== undefined) {
          logger.debug(`${source} skipped: ${result.reason}`);
          send({ kind: 'filter-skipped', reason: result.reason, isLive: result.isLive });
        }

        return result.response;
      },
    });

    // 4. Bridge with ISOLATED world holding true state.
    //    Enforcer is created after bridge, and bridge must be able to notify it:
    //    this hook avoids order inversion — hooks must remain the first thing that runs.
    let onEnabledChange: (next: boolean) => void = () => {};
    const bridge = createMainBridge((next) => {
      enabled = next;
      onEnabledChange(next);
    }, lifetime.signal);

    send = bridge.send;
    for (const message of pending.splice(0)) send(message);

    // 5. Plan C: forcing minimal quality. Placed after hooks because it has
    //    no timing constraints — player doesn't exist yet at `document_start`,
    //    and enforcer waits for it with an observer that turns off once found.
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

/** Only for dev diagnostics: list surviving mimeTypes. */
function mimeTypesOf(response: unknown): { adaptive: unknown[]; progressive: unknown[] } {
  const streamingData = (response as { streamingData?: Record<string, unknown> } | null)
    ?.streamingData;
  const read = (field: string): unknown[] => {
    const list = streamingData?.[field];
    return Array.isArray(list) ? list.map((f: { mimeType?: unknown }) => f?.mimeType) : [];
  };
  return { adaptive: read('adaptiveFormats'), progressive: read('formats') };
}
