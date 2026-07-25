/**
 * @vitest-environment happy-dom
 *
 * Plan C: forcing minimal quality. Main mechanism since
 * SABR invalidated format filtering (RESEARCH.md R1).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQualityEnforcer,
  findPlayer,
  forceLowestQuality,
  type PlayerLike,
  pickLowestQuality,
} from '../../lib/player/quality';

/** Fake player registering received calls. */
function fakePlayer(available: unknown = ['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny']) {
  const calls: { range: [string, string][]; quality: string[] } = { range: [], quality: [] };
  const player: PlayerLike = {
    getAvailableQualityLevels: () => available,
    setPlaybackQualityRange: (min, max) => calls.range.push([min, max]),
    setPlaybackQuality: (quality) => calls.quality.push(quality),
  };
  return { player, calls };
}

describe('pickLowestQuality', () => {
  it('picks lightest level among offered ones', () => {
    expect(pickLowestQuality(['hd1080', 'medium', 'hd720'])).toBe('medium');
    expect(pickLowestQuality(['hd1080', 'hd720'])).toBe('hd720');
    expect(pickLowestQuality(['tiny', 'hd1080'])).toBe('tiny');
  });

  it('ignores entries that are not known levels, such as "auto"', () => {
    expect(pickLowestQuality(['auto', 'unknown', 'large'])).toBe('large');
  });

  it('falls back to tiny if list is unreadable or empty', () => {
    expect(pickLowestQuality(undefined)).toBe('tiny');
    expect(pickLowestQuality(null)).toBe('tiny');
    expect(pickLowestQuality('hd720')).toBe('tiny');
    expect(pickLowestQuality([])).toBe('tiny');
    expect(pickLowestQuality(['auto'])).toBe('tiny');
  });
});

describe('forceLowestQuality', () => {
  it('★ sets the RANGE and not just current quality', () => {
    // Without range, ABR would go back up on first automatic adjustment.
    const { player, calls } = fakePlayer();
    const outcome = forceLowestQuality(player);

    expect(outcome).toEqual({ applied: true, level: 'tiny' });
    expect(calls.range).toEqual([['tiny', 'tiny']]);
    expect(calls.quality).toEqual(['tiny']);
  });

  it('uses lowest level actually available', () => {
    const { player, calls } = fakePlayer(['hd720', 'medium']);
    expect(forceLowestQuality(player).level).toBe('medium');
    expect(calls.range).toEqual([['medium', 'medium']]);
  });

  it('works even if setPlaybackQuality does not exist', () => {
    const player: PlayerLike = { setPlaybackQualityRange: () => undefined };
    expect(forceLowestQuality(player).applied).toBe(true);
  });

  it.each([
    ['missing player', null, 'no-player'],
    ['missing API', {}, 'no-api'],
  ])('fail-open: %s', (_name, player, reason) => {
    const outcome = forceLowestQuality(player as PlayerLike | null);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe(reason);
  });

  it('fail-open if API throws', () => {
    const player: PlayerLike = {
      setPlaybackQualityRange: () => {
        throw new Error('API changed');
      },
    };
    const outcome = forceLowestQuality(player);
    expect(outcome).toEqual({ applied: false, level: null, reason: 'threw' });
  });

  it('fail-open if getAvailableQualityLevels throws', () => {
    const player: PlayerLike = {
      getAvailableQualityLevels: () => {
        throw new Error('boom');
      },
      setPlaybackQualityRange: () => undefined,
    };
    expect(forceLowestQuality(player).reason).toBe('threw');
  });
});

describe('findPlayer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds #movie_player', () => {
    document.body.innerHTML = '<div id="movie_player"></div>';
    expect(findPlayer(document)).not.toBeNull();
  });

  it('returns null if not present', () => {
    expect(findPlayer(document)).toBeNull();
  });
});

describe('createQualityEnforcer', () => {
  const controllers: AbortController[] = [];

  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.abort();
    document.body.innerHTML = '';
  });

  function setup(enabled: boolean, navigationEvents: string[] = ['yt-navigate-finish']) {
    const controller = new AbortController();
    controllers.push(controller);
    const outcomes: { trigger: string; applied: boolean }[] = [];
    const enforcer = createQualityEnforcer(
      {
        root: document,
        events: window,
        signal: controller.signal,
        navigationEvents,
        onOutcome: (outcome, trigger) => outcomes.push({ trigger, applied: outcome.applied }),
      },
      enabled,
    );
    return { enforcer, outcomes, controller };
  }

  /** Mounts fake player in DOM and returns received calls. */
  function mountPlayer() {
    const element = document.createElement('div');
    element.id = 'movie_player';
    const calls: string[] = [];
    Object.assign(element, {
      getAvailableQualityLevels: () => ['hd1080', 'tiny'],
      setPlaybackQualityRange: (min: string) => calls.push(min),
      setPlaybackQuality: () => undefined,
    });
    document.body.append(element);
    return calls;
  }

  it('applies to present player', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(true);
    expect(enforcer.apply('test').applied).toBe(true);
    expect(calls).toEqual(['tiny']);
  });

  it('★ does nothing if disabled', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(false);
    expect(enforcer.apply('test').reason).toBe('disabled');
    expect(calls).toEqual([]);
    expect(enforcer.enabled).toBe(false);
  });

  it('setEnabled(true) applies immediately', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(false);
    enforcer.setEnabled(true);
    expect(enforcer.enabled).toBe(true);
    expect(calls).toEqual(['tiny']);
  });

  it('★ reapplies on every SPA navigation: YouTube resets quality', () => {
    const calls = mountPlayer();
    setup(true).enforcer.apply('startup');
    expect(calls).toHaveLength(1);

    window.dispatchEvent(new Event('yt-navigate-finish'));
    expect(calls).toHaveLength(2);
  });

  it('★ reapplies on source change (playlist, autoplay)', () => {
    const calls = mountPlayer();
    setup(true).enforcer.apply('startup');

    const video = document.createElement('video');
    document.body.append(video);
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));

    expect(calls.length).toBeGreaterThan(1);
  });

  it('waits for player with MutationObserver, without polling', async () => {
    const { enforcer, outcomes } = setup(true);
    expect(enforcer.apply('startup').applied).toBe(false);

    const calls = mountPlayer();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual(['tiny']);
    expect(outcomes.some((o) => o.trigger === 'player-appeared' && o.applied)).toBe(true);
  });

  it('★ signal abort unmounts everything: no listener survives', () => {
    const calls = mountPlayer();
    const { enforcer, controller } = setup(true);
    enforcer.apply('startup');
    calls.length = 0;

    controller.abort();
    window.dispatchEvent(new Event('yt-navigate-finish'));

    expect(calls).toEqual([]);
  });

  it('does not use timers: no setInterval nor setTimeout', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    mountPlayer();
    setup(true).enforcer.apply('startup');
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    interval.mockRestore();
    timeout.mockRestore();
  });
});
