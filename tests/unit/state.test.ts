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

  it('off mode: never active, even if tab was enabled', () => {
    expect(
      resolveEnabled('off', tabState({ enabled: true }), settings({ mode: 'off' }), watch),
    ).toBe(false);
  });

  it('always mode: always active', () => {
    expect(resolveEnabled('always', tabState(), settings({ mode: 'always' }), watch)).toBe(true);
  });

  it('★ per-tab mode: independent per tab (issue #3)', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: false });
    expect(resolveEnabled('per-tab', tabState({ enabled: true }), config, watch)).toBe(true);
    expect(resolveEnabled('per-tab', tabState({ enabled: false }), config, watch)).toBe(false);
  });

  it('per-tab on YouTube Music: active if autoEnableOnMusic', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: true });
    expect(resolveEnabled('per-tab', tabState(), config, music)).toBe(true);
    expect(resolveEnabled('per-tab', tabState(), config, watch)).toBe(false);
  });

  it('disabled autoEnableOnMusic does not alter per-tab decision', () => {
    const config = settings({ mode: 'per-tab', autoEnableOnMusic: false });
    expect(resolveEnabled('per-tab', tabState(), config, music)).toBe(false);
  });

  it('a missing url does not throw an error', () => {
    expect(resolveEnabled('per-tab', tabState(), settings(), undefined)).toBe(false);
  });
});

describe('isMusicUrl', () => {
  it.each([
    ['https://music.youtube.com/watch?v=x', true],
    ['https://www.youtube.com/watch?v=x', false],
    ['not-a-url', false],
    // Substring matching is avoided: hostile host cannot trick us.
    ['https://music.youtube.com.example.invalid/', false],
  ])('%s → %s', (url, expected) => {
    expect(isMusicUrl(url)).toBe(expected);
  });

  it('undefined → false', () => {
    expect(isMusicUrl(undefined)).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('does not trust disk: any wrong type field reverts to default', () => {
    const result = normalizeSettings({
      mode: 'made-up-mode',
      autoEnableOnMusic: null,
      excludedChannels: ['ok', 42, null],
    });

    expect(result.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(result.autoEnableOnMusic).toBe(true);
    expect(result.excludedChannels).toEqual(['ok']);
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['number', 1],
    ['undefined', undefined],
  ])('%s → complete defaults', (_name, input) => {
    expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves valid values', () => {
    expect(normalizeSettings({ mode: 'always' }).mode).toBe('always');
    expect(normalizeSettings({ mode: 'off' }).mode).toBe('off');
    expect(normalizeSettings({ autoEnableOnMusic: false }).autoEnableOnMusic).toBe(false);
  });


});
