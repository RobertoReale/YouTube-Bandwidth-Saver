/**
 * @vitest-environment happy-dom
 *
 * Piano C: forzatura della qualità minima. È il meccanismo principale da quando
 * SABR ha invalidato il filtro dei formati (RESEARCH.md R1).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQualityEnforcer,
  findPlayer,
  forceLowestQuality,
  type PlayerLike,
  pickLowestQuality,
} from '../../lib/player/quality';

/** Player finto che registra le chiamate ricevute. */
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
  it('sceglie il livello più leggero fra quelli offerti', () => {
    expect(pickLowestQuality(['hd1080', 'medium', 'hd720'])).toBe('medium');
    expect(pickLowestQuality(['hd1080', 'hd720'])).toBe('hd720');
    expect(pickLowestQuality(['tiny', 'hd1080'])).toBe('tiny');
  });

  it('ignora le voci che non sono livelli noti, come "auto"', () => {
    expect(pickLowestQuality(['auto', 'unknown', 'large'])).toBe('large');
  });

  it("ripiega su tiny se l'elenco è illeggibile o vuoto", () => {
    expect(pickLowestQuality(undefined)).toBe('tiny');
    expect(pickLowestQuality(null)).toBe('tiny');
    expect(pickLowestQuality('hd720')).toBe('tiny');
    expect(pickLowestQuality([])).toBe('tiny');
    expect(pickLowestQuality(['auto'])).toBe('tiny');
  });
});

describe('forceLowestQuality', () => {
  it('★ fissa il RANGE e non solo la qualità corrente', () => {
    // Senza il range, l'ABR risalirebbe al primo aggiustamento automatico.
    const { player, calls } = fakePlayer();
    const outcome = forceLowestQuality(player);

    expect(outcome).toEqual({ applied: true, level: 'tiny' });
    expect(calls.range).toEqual([['tiny', 'tiny']]);
    expect(calls.quality).toEqual(['tiny']);
  });

  it('usa il livello più basso realmente disponibile', () => {
    const { player, calls } = fakePlayer(['hd720', 'medium']);
    expect(forceLowestQuality(player).level).toBe('medium');
    expect(calls.range).toEqual([['medium', 'medium']]);
  });

  it('funziona anche se setPlaybackQuality non esiste', () => {
    const player: PlayerLike = { setPlaybackQualityRange: () => undefined };
    expect(forceLowestQuality(player).applied).toBe(true);
  });

  it.each([
    ['player assente', null, 'no-player'],
    ['API assente', {}, 'no-api'],
  ])('fail-open: %s', (_name, player, reason) => {
    const outcome = forceLowestQuality(player as PlayerLike | null);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe(reason);
  });

  it("fail-open se l'API lancia", () => {
    const player: PlayerLike = {
      setPlaybackQualityRange: () => {
        throw new Error('API cambiata');
      },
    };
    const outcome = forceLowestQuality(player);
    expect(outcome).toEqual({ applied: false, level: null, reason: 'threw' });
  });

  it('fail-open se getAvailableQualityLevels lancia', () => {
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

  it('trova #movie_player', () => {
    document.body.innerHTML = '<div id="movie_player"></div>';
    expect(findPlayer(document)).not.toBeNull();
  });

  it("restituisce null se non c'è", () => {
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

  /** Installa un player finto nel DOM e restituisce le chiamate ricevute. */
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

  it('applica al player presente', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(true);
    expect(enforcer.apply('test').applied).toBe(true);
    expect(calls).toEqual(['tiny']);
  });

  it('★ non fa nulla se disabilitato', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(false);
    expect(enforcer.apply('test').reason).toBe('disabled');
    expect(calls).toEqual([]);
    expect(enforcer.enabled).toBe(false);
  });

  it('setEnabled(true) applica subito', () => {
    const calls = mountPlayer();
    const { enforcer } = setup(false);
    enforcer.setEnabled(true);
    expect(enforcer.enabled).toBe(true);
    expect(calls).toEqual(['tiny']);
  });

  it('★ riapplica a ogni navigazione SPA: YouTube reimposta la qualità', () => {
    const calls = mountPlayer();
    setup(true).enforcer.apply('avvio');
    expect(calls).toHaveLength(1);

    window.dispatchEvent(new Event('yt-navigate-finish'));
    expect(calls).toHaveLength(2);
  });

  it('★ riapplica al cambio di sorgente (playlist, autoplay)', () => {
    const calls = mountPlayer();
    setup(true).enforcer.apply('avvio');

    const video = document.createElement('video');
    document.body.append(video);
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));

    expect(calls.length).toBeGreaterThan(1);
  });

  it('aspetta il player con un MutationObserver, senza polling', async () => {
    const { enforcer, outcomes } = setup(true);
    expect(enforcer.apply('avvio').applied).toBe(false);

    const calls = mountPlayer();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual(['tiny']);
    expect(outcomes.some((o) => o.trigger === 'player-comparso' && o.applied)).toBe(true);
  });

  it("★ l'abort smonta tutto: nessun listener sopravvive", () => {
    const calls = mountPlayer();
    const { enforcer, controller } = setup(true);
    enforcer.apply('avvio');
    calls.length = 0;

    controller.abort();
    window.dispatchEvent(new Event('yt-navigate-finish'));

    expect(calls).toEqual([]);
  });

  it('non usa timer: nessun setInterval né setTimeout', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    mountPlayer();
    setup(true).enforcer.apply('avvio');
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    interval.mockRestore();
    timeout.mockRestore();
  });
});
