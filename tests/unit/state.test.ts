import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../lib/settings';
import { emptyTabState, isMusicUrl, resolveEnabled } from '../../lib/state';
import type { Settings, TabState } from '../../lib/types';

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

function tabState(patch: Partial<TabState> = {}): TabState {
  return { ...emptyTabState(), ...patch };
}

describe('resolveEnabled', () => {
  const watch = 'https://www.youtube.com/watch?v=abc';
  const music = 'https://music.youtube.com/watch?v=abc';

  it('modalità off: mai attiva, nemmeno se la scheda era accesa', () => {
    expect(
      resolveEnabled('off', tabState({ enabled: true }), settings({ mode: 'off' }), watch),
    ).toBe(false);
  });

  it('modalità always: sempre attiva', () => {
    expect(resolveEnabled('always', tabState(), settings({ mode: 'always' }), watch)).toBe(true);
  });

  it('★ modalità per-tab: indipendente per scheda (issue #3)', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: false });
    expect(resolveEnabled('per-tab', tabState({ enabled: true }), config, watch)).toBe(true);
    expect(resolveEnabled('per-tab', tabState({ enabled: false }), config, watch)).toBe(false);
  });

  it('per-tab su YouTube Music: attiva se autoEnableOnMusic', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: true });
    expect(resolveEnabled('per-tab', tabState(), config, music)).toBe(true);
    expect(resolveEnabled('per-tab', tabState(), config, watch)).toBe(false);
  });

  it('autoEnableOnMusic disattivato non altera la decisione per-scheda', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: false });
    expect(resolveEnabled('per-tab', tabState(), config, music)).toBe(false);
  });

  it('un url assente non manda in errore', () => {
    expect(resolveEnabled('per-tab', tabState(), settings(), undefined)).toBe(false);
  });
});

describe('isMusicUrl', () => {
  it.each([
    ['https://music.youtube.com/watch?v=x', true],
    ['https://www.youtube.com/watch?v=x', false],
    ['non-un-url', false],
    // Non si fa matching su sottostringhe: un host ostile non ci inganna.
    ['https://music.youtube.com.example.invalid/', false],
  ])('%s → %s', (url, expected) => {
    expect(isMusicUrl(url)).toBe(expected);
  });

  it('undefined → false', () => {
    expect(isMusicUrl(undefined)).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('non si fida del disco: ogni campo di tipo errato torna al default', () => {
    const result = normalizeSettings({
      mode: 'modalità-inventata',
      showThumbnail: 'si',
      showPlayerButton: 0,
      autoEnableOnMusic: null,
      excludedChannels: ['ok', 42, null],
    });

    expect(result.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(result.showThumbnail).toBe(false);
    expect(result.showPlayerButton).toBe(true);
    expect(result.autoEnableOnMusic).toBe(true);
    expect(result.excludedChannels).toEqual(['ok']);
  });

  it.each([
    ['null', null],
    ['stringa', 'x'],
    ['numero', 1],
    ['undefined', undefined],
  ])('%s → default completi', (_name, input) => {
    expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it('preserva i valori validi', () => {
    expect(normalizeSettings({ mode: 'always', showThumbnail: true }).mode).toBe('always');
    expect(normalizeSettings({ mode: 'off' }).mode).toBe('off');
    expect(normalizeSettings({ showThumbnail: true }).showThumbnail).toBe(true);
    expect(normalizeSettings({ showPlayerButton: false }).showPlayerButton).toBe(false);
    expect(normalizeSettings({ autoEnableOnMusic: false }).autoEnableOnMusic).toBe(false);
  });

  it('il default di showThumbnail è OFF: la thumbnail costa banda', () => {
    expect(DEFAULT_SETTINGS.showThumbnail).toBe(false);
  });
});
