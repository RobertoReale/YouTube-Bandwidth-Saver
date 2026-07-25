/**
 * MAIN world, `document_start`. PLAN.md §5.
 *
 * ★ Vincolo assoluto (§11): nessun `await`, nessuna operazione asincrona prima
 *   di `installHooks`. Un solo `await` di troppo e lo script inline di YouTube
 *   ha già assegnato `ytInitialPlayerResponse`.
 *
 * Questo script non ha accesso alle `chrome.*` API. La decisione iniziale arriva
 * dalla cache sincrona (`lib/sync-cache.ts`), poi viene corretta dall'ISOLATED
 * world via ponte.
 *
 * Due meccanismi, in ordine di preferenza:
 *
 *  1. **Qualità minima forzata** (piano C, `quality.ts`) — la via principale da
 *     quando YouTube usa SABR: il server decide i byte, quindi l'unica leva è
 *     chiedergli la qualità più bassa. Riduce la banda, non la azzera.
 *  2. **Filtro dei formati** (`format-filter.ts`) — resta installato come
 *     fallback per i client che ricevono ancora tracce con URL diretti, dove
 *     azzera davvero i byte video. Rinuncia da sé se vede SABR.
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
    // 1. Decisione sincrona. Default `false`: senza informazione, YouTube normale.
    let enabled = readCachedDecision();

    /** Vita di tutti i listener e observer di questo frame (§11). */
    const lifetime = new AbortController();

    // Diagnostica: esiste SOLO nelle build di sviluppo. `import.meta.env.DEV` è
    // una costante sostituita da Vite, quindi in produzione questo blocco e
    // l'array che alimenta vengono eliminati dal tree-shaking.
    const trace: unknown[] = [];
    if (import.meta.env.DEV) {
      Object.defineProperty(window, '__ytAudioOnlyDebug', {
        configurable: true,
        get: () => ({ enabled, trace }),
      });
    }

    // 2. Coda per i report emessi prima che il ponte sia pronto.
    const pending: MainToIsolated[] = [];
    let send: (message: MainToIsolated) => void = (message) => {
      pending.push(message);
    };

    // 3. Hook installati SUBITO, sincronamente.
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
            // Che cosa è rimasto davvero nel response consegnato al player.
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
          logger.debug(`${source} saltato: ${result.reason}`);
          send({ kind: 'filter-skipped', reason: result.reason, isLive: result.isLive });
        }

        return result.response;
      },
    });

    // 4. Ponte con l'ISOLATED world, che possiede la verità sullo stato.
    //    L'enforcer nasce dopo il ponte, e il ponte deve poterlo avvisare: questo
    //    gancio evita di invertire l'ordine, che è vincolato — gli hook devono
    //    restare la prima cosa che accade.
    let onEnabledChange: (next: boolean) => void = () => {};
    const bridge = createMainBridge((next) => {
      enabled = next;
      onEnabledChange(next);
    }, lifetime.signal);

    send = bridge.send;
    for (const message of pending.splice(0)) send(message);

    // 5. Piano C: forzatura della qualità minima. Va dopo gli hook perché non
    //    ha vincoli di tempo — il player non esiste ancora a `document_start`,
    //    e l'enforcer lo aspetta con un observer che si spegne appena lo trova.
    const enforcer = createQualityEnforcer(
      {
        root: document,
        events: window,
        signal: lifetime.signal,
        navigationEvents: [YT_EVENTS.navigateFinish],
        onOutcome: (outcome, trigger) => {
          logger.debug(`qualità (${trigger}):`, outcome);
          if (import.meta.env.DEV) trace.push({ source: 'quality', trigger, ...outcome });
        },
      },
      enabled,
    );

    enforcer.apply('avvio');
    onEnabledChange = (next) => enforcer.setEnabled(next);

    window.addEventListener('pagehide', () => lifetime.abort(), { signal: lifetime.signal });
  },
});

/** Solo per la diagnostica di sviluppo: elenca i mimeType sopravvissuti. */
function mimeTypesOf(response: unknown): { adaptive: unknown[]; progressive: unknown[] } {
  const streamingData = (response as { streamingData?: Record<string, unknown> } | null)
    ?.streamingData;
  const read = (field: string): unknown[] => {
    const list = streamingData?.[field];
    return Array.isArray(list) ? list.map((f: { mimeType?: unknown }) => f?.mimeType) : [];
  };
  return { adaptive: read('adaptiveFormats'), progressive: read('formats') };
}
