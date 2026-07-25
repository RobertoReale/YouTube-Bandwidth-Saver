/**
 * Piano C del rischio A (`PLAN.md` §15): forzare la qualità minima.
 *
 * Perché non filtriamo più i formati: dal 2026-07-25 YouTube consegna
 * `serverAbrStreamingUrl` e nessun URL diretto sulle tracce (RESEARCH.md R1).
 * È il server a decidere quali byte mandare, quindi l'unica leva che il client
 * ha davvero è **dire al server che vuole la qualità più bassa**.
 *
 * Onestà sul risultato: questo NON azzera i byte video, li riduce. È la
 * differenza fra il piano C e il piano D, e va detta anche nella UI e nella
 * scheda dello store (`PUBLISHING.md`: niente numeri non misurati).
 *
 * Regole rispettate: nessun polling (`PLAN.md` §11), ogni listener e observer
 * ha il suo teardown, e qualunque errore è fail-open — se l'API del player
 * cambia, YouTube continua a funzionare normalmente.
 */

import { DOM, QUALITY_LEVELS, type QualityLevel } from '../selectors';

/** Il sottoinsieme dell'API del player YouTube che usiamo. Tutto opzionale. */
export interface PlayerLike {
  setPlaybackQualityRange?: (min: string, max: string) => void;
  setPlaybackQuality?: (quality: string) => void;
  getAvailableQualityLevels?: () => unknown;
  getPlaybackQuality?: () => unknown;
}

export interface QualityOutcome {
  readonly applied: boolean;
  readonly level: QualityLevel | null;
  readonly reason?: 'disabled' | 'no-player' | 'no-api' | 'threw';
}

/**
 * Scegli il livello più leggero fra quelli che il player dichiara disponibili.
 *
 * Non usiamo `tiny` a occhi chiusi: se un video non ha una traccia 144p,
 * chiedere `tiny` può essere ignorato. Preferiamo il più basso realmente
 * offerto, e ripieghiamo su `tiny` solo se l'elenco è illeggibile.
 */
export function pickLowestQuality(available: unknown): QualityLevel {
  if (!Array.isArray(available)) return 'tiny';
  const offered = new Set(available.filter((entry): entry is string => typeof entry === 'string'));
  for (const level of QUALITY_LEVELS) {
    if (offered.has(level)) return level;
  }
  return 'tiny';
}

/** Trova l'elemento del player, provando la catena di fallback dei selettori. */
export function findPlayer(root: ParentNode): PlayerLike | null {
  for (const selector of DOM.moviePlayer) {
    const element = root.querySelector(selector);
    // L'elemento `#movie_player` di YouTube porta i metodi dell'API su di sé.
    if (element !== null) return element as unknown as PlayerLike;
  }
  return null;
}

/**
 * Impone la qualità minima a un player. Non lancia mai.
 *
 * Chiamiamo `setPlaybackQualityRange` **e** `setPlaybackQuality`: la prima fissa
 * un tetto che impedisce all'ABR di risalire durante la riproduzione, la seconda
 * applica il cambio subito. Da sola, la seconda verrebbe scavalcata al primo
 * aggiustamento automatico.
 */
export function forceLowestQuality(player: PlayerLike | null): QualityOutcome {
  if (player === null) return { applied: false, level: null, reason: 'no-player' };
  if (typeof player.setPlaybackQualityRange !== 'function') {
    return { applied: false, level: null, reason: 'no-api' };
  }

  try {
    const level = pickLowestQuality(player.getAvailableQualityLevels?.());
    player.setPlaybackQualityRange(level, level);
    player.setPlaybackQuality?.(level);
    return { applied: true, level };
  } catch {
    return { applied: false, level: null, reason: 'threw' };
  }
}

export interface EnforcerDeps {
  /** Documento su cui cercare player ed elemento video. */
  readonly root: Document;
  /** Bersaglio degli eventi di navigazione SPA. Iniettabile per i test. */
  readonly events: Pick<EventTarget, 'addEventListener'>;
  readonly signal: AbortSignal;
  /** Nomi degli eventi YouTube che indicano "il player è cambiato". */
  readonly navigationEvents: readonly string[];
  readonly onOutcome?: (outcome: QualityOutcome, trigger: string) => void;
}

export interface QualityEnforcer {
  /** Applica subito, se possibile. Restituisce l'esito. */
  apply(trigger: string): QualityOutcome;
  /** Attiva o disattiva senza smontare i listener. */
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

/**
 * Riapplica la qualità minima ogni volta che il player può averla reimpostata:
 * a ogni navigazione SPA e a ogni nuovo media caricato.
 *
 * YouTube reimposta la qualità a ogni video — è il motivo per cui una singola
 * chiamata all'avvio non basta e il piano lo annotava già (§2, "YouTube
 * reimposta la qualità a ogni video").
 */
export function createQualityEnforcer(
  deps: EnforcerDeps,
  initialEnabled: boolean,
): QualityEnforcer {
  let enabled = initialEnabled;
  let observer: MutationObserver | null = null;

  const apply = (trigger: string): QualityOutcome => {
    if (!enabled) return { applied: false, level: null, reason: 'disabled' };
    const outcome = forceLowestQuality(findPlayer(deps.root));
    deps.onOutcome?.(outcome, trigger);
    if (!outcome.applied && outcome.reason === 'no-player') waitForPlayer();
    return outcome;
  };

  /**
   * Il player non esiste ancora: lo aspettiamo con un observer che si spegne
   * appena lo trova. Nessun `setInterval` (§11).
   */
  const waitForPlayer = (): void => {
    if (observer !== null || deps.signal.aborted) return;
    observer = new MutationObserver(() => {
      if (findPlayer(deps.root) === null) return;
      observer?.disconnect();
      observer = null;
      apply('player-comparso');
    });
    observer.observe(deps.root.documentElement, { childList: true, subtree: true });
    deps.signal.addEventListener('abort', () => {
      observer?.disconnect();
      observer = null;
    });
  };

  for (const eventName of deps.navigationEvents) {
    deps.events.addEventListener(eventName, () => apply(eventName), { signal: deps.signal });
  }

  // `loadstart` sull'elemento video cattura anche i cambi di sorgente che non
  // passano da una navigazione (playlist, autoplay). In fase di cattura, così
  // non serve riagganciarsi quando l'elemento viene sostituito.
  deps.root.addEventListener('loadstart', () => apply('loadstart'), {
    capture: true,
    signal: deps.signal,
  });

  return {
    apply,
    setEnabled(next: boolean): void {
      enabled = next;
      if (next) apply('abilitata');
    },
    get enabled(): boolean {
      return enabled;
    },
  };
}
