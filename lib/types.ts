/** Shared types across all three worlds. */

export type Mode = 'off' | 'per-tab' | 'always';

/** Persistent preferences (`storage.sync`). */
export interface Settings {
  mode: Mode;
  showOverlay: boolean;
  autoEnableOnMusic: boolean;
}

/** Volatile per-tab state (`storage.session`, does not touch disk). */
export interface TabState {
  enabled: boolean;
  lastAppliedAt: number;
}
