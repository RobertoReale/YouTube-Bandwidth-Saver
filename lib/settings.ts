/** PLAN.md §7 — persistent preferences in `storage.sync`. */

import { browser } from 'wxt/browser';
import type { Mode, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'per-tab',
  showThumbnail: false, // default OFF: thumbnail costs bandwidth (RF-4)
  showOverlay: true, // default ON: hides 144p video
  autoEnableOnMusic: true,
  excludedChannels: [],
};

const KEY = 'settings';

function isMode(value: unknown): value is Mode {
  return value === 'off' || value === 'per-tab' || value === 'always';
}

/** Normalizes any value read from storage. Never trust disk. */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const input = raw as Record<string, unknown>;
  return {
    mode: isMode(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    showThumbnail:
      typeof input.showThumbnail === 'boolean'
        ? input.showThumbnail
        : DEFAULT_SETTINGS.showThumbnail,
    showOverlay:
      typeof input.showOverlay === 'boolean'
        ? input.showOverlay
        : DEFAULT_SETTINGS.showOverlay,
    autoEnableOnMusic:
      typeof input.autoEnableOnMusic === 'boolean'
        ? input.autoEnableOnMusic
        : DEFAULT_SETTINGS.autoEnableOnMusic,
    excludedChannels: Array.isArray(input.excludedChannels)
      ? input.excludedChannels.filter((entry): entry is string => typeof entry === 'string')
      : DEFAULT_SETTINGS.excludedChannels,
  };
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
