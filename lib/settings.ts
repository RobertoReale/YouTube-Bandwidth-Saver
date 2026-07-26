/** Persistent preferences in `storage.sync`. */

import { browser } from 'wxt/browser';
import type { Mode, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'per-tab',
  showOverlay: true, // default ON: hides 144p video
  autoEnableOnMusic: true,
};

const KEY = 'settings';

function isMode(value: unknown): value is Mode {
  return value === 'off' || value === 'per-tab' || value === 'always';
}

/** Normalizes any value read from storage. Never trust disk. */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const input = raw as Record<string, unknown>;
  const normalized: Settings = {
    mode: isMode(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    showOverlay:
      typeof input.showOverlay === 'boolean' ? input.showOverlay : DEFAULT_SETTINGS.showOverlay,
    autoEnableOnMusic:
      typeof input.autoEnableOnMusic === 'boolean'
        ? input.autoEnableOnMusic
        : DEFAULT_SETTINGS.autoEnableOnMusic,
  };

  return normalized;
}

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.sync.get(KEY);
    return normalizeSettings(stored[KEY]);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await browser.storage.sync.set({ [KEY]: next });
  return next;
}
