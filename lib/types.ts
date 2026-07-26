/** Shared types across all three worlds. */

export type Mode = 'off' | 'per-tab' | 'always';

/** Persistent preferences (`storage.sync`). */
export interface Settings {
  mode: Mode;
  showOverlay: boolean;
  autoEnableOnMusic: boolean;
  excludedChannels: readonly string[];
}

/** Volatile per-tab state (`storage.session`, does not touch disk). */
export interface TabState {
  enabled: boolean;
  videoId: string | null;
  isLive: boolean;
  /** Local estimate, NEVER transmitted. */
  bytesSaved: number;
  lastAppliedAt: number;
}

/** Why the filter was not applied. Fail-open, never throw. */
export type SkipReason =
  | 'not-a-player-response'
  | 'live-stream'
  | 'no-streaming-data'
  | 'no-video-formats'
  | 'no-audio-formats'
  | 'drm-protected'
  /** Server decides stream, formats are metadata. */
  | 'server-abr'
  | 'disabled'
  | 'internal-error';

export interface FilterStats {
  videoFormatsRemoved: number;
  progressiveFormatsRemoved: number;
  audioFormatsKept: number;
  unknownFormatsKept: number;
  /** Sum of removed `contentLength`. Estimate, labeled as such in UI. */
  estimatedBytesSaved: number;
}

/**
 * Discrepancy between expected schema and observed schema.
 * Feeds LOCAL counter. Never leaves device.
 */
export interface SchemaViolation {
  /** Field path, e.g. `streamingData.adaptiveFormats`. */
  path: string;
  /** What was expected. */
  expected: string;
  /** What was found (only type or enum, NEVER value: privacy). */
  found: string;
  at: number;
}

export const HOOK_SOURCES = ['property', 'fetch', 'xhr'] as const;
export type HookSource = (typeof HOOK_SOURCES)[number];
