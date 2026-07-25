/**
 * Plan C of Risk A (`PLAN.md` §15): forcing minimal quality.
 *
 * Why we no longer filter formats: as of 2026-07-25 YouTube delivers
 * `serverAbrStreamingUrl` and no direct URLs on tracks (RESEARCH.md R1).
 * Server decides which bytes to send, so the only lever client
 * really has is **telling server it wants the lowest quality**.
 *
 * Honesty on result: this does NOT zero out video bytes, it reduces them. It is the
 * difference between plan C and plan D, and must be stated in UI and
 * store listing (`PUBLISHING.md`: no unmeasured numbers).
 *
 * Rules respected: no polling (`PLAN.md` §11), every listener and observer
 * has its teardown, and any error is fail-open — if player API
 * changes, YouTube continues operating normally.
 */

import { DOM, QUALITY_LEVELS, type QualityLevel } from '../selectors';

/** Subset of YouTube player API we use. All optional. */
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
 * Picks lightest quality level from those declared available by player.
 *
 * We don't blindly use `tiny`: if a video has no 144p track,
 * requesting `tiny` might be ignored. We prefer the lowest actually
 * offered, falling back to `tiny` only if list is unreadable.
 */
export function pickLowestQuality(available: unknown): QualityLevel {
  if (!Array.isArray(available)) return 'tiny';
  const offered = new Set(available.filter((entry): entry is string => typeof entry === 'string'));
  for (const level of QUALITY_LEVELS) {
    if (offered.has(level)) return level;
  }
  return 'tiny';
}

/** Finds player element, trying selector fallback chain. */
export function findPlayer(root: ParentNode): PlayerLike | null {
  for (const selector of DOM.moviePlayer) {
    const element = root.querySelector(selector);
    // YouTube's `#movie_player` element carries API methods on itself.
    if (element !== null) return element as unknown as PlayerLike;
  }
  return null;
}

/**
 * Forces minimal quality on a player. Never throws.
 *
 * We call `setPlaybackQualityRange` **and** `setPlaybackQuality`: first sets
 * a ceiling preventing ABR from going up during playback, second
 * applies change immediately. Alone, second would be overridden on first
 * automatic adjustment.
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
  /** Document on which to search for player and video element. */
  readonly root: Document;
  /** Target for SPA navigation events. Injectable for tests. */
  readonly events: Pick<EventTarget, 'addEventListener'>;
  readonly signal: AbortSignal;
  /** YouTube event names indicating "player has changed". */
  readonly navigationEvents: readonly string[];
  readonly onOutcome?: (outcome: QualityOutcome, trigger: string) => void;
}

export interface QualityEnforcer {
  /** Applies immediately, if possible. Returns outcome. */
  apply(trigger: string): QualityOutcome;
  /** Enables or disables without unmounting listeners. */
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

/**
 * Reapplies minimal quality whenever player might have reset it:
 * on every SPA navigation and on every new media loaded.
 *
 * YouTube resets quality on every video — reason why a single
 * startup call is not enough, as plan already noted (§2, "YouTube
 * resets quality on every video").
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
   * Player doesn't exist yet: we wait for it with an observer that turns off
   * as soon as found. No `setInterval` (§11).
   */
  const waitForPlayer = (): void => {
    if (observer !== null || deps.signal.aborted) return;
    observer = new MutationObserver(() => {
      if (findPlayer(deps.root) === null) return;
      observer?.disconnect();
      observer = null;
      apply('player-appeared');
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

  // `loadstart` on video element also catches source changes not going
  // through navigation (playlist, autoplay). In capture phase, so
  // no need to re-attach when element is replaced.
  deps.root.addEventListener('loadstart', () => apply('loadstart'), {
    capture: true,
    signal: deps.signal,
  });

  return {
    apply,
    setEnabled(next: boolean): void {
      enabled = next;
      if (next) apply('enabled');
    },
    get enabled(): boolean {
      return enabled;
    },
  };
}
