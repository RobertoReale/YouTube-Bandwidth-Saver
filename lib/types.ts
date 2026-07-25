/** PLAN.md §7 — modello di stato. Tipi condivisi fra i tre mondi. */

export type Mode = 'off' | 'per-tab' | 'always';

/** Preferenze persistenti (`storage.sync`). */
export interface Settings {
  mode: Mode;
  showThumbnail: boolean;
  showPlayerButton: boolean;
  autoEnableOnMusic: boolean;
  excludedChannels: readonly string[];
}

/** Stato volatile per-scheda (`storage.session`, non tocca il disco). */
export interface TabState {
  enabled: boolean;
  videoId: string | null;
  isLive: boolean;
  /** Stima locale, MAI trasmessa (§13). */
  bytesSaved: number;
  lastAppliedAt: number;
}

/** Perché il filtro non è stato applicato. Fail-open, mai un'eccezione. */
export type SkipReason =
  | 'not-a-player-response'
  | 'live-stream'
  | 'no-streaming-data'
  | 'no-video-formats'
  | 'no-audio-formats'
  | 'drm-protected'
  /** SABR: il server decide lo stream, i formati sono metadati. Vedi R1. */
  | 'server-abr'
  | 'disabled'
  | 'internal-error';

export interface FilterStats {
  videoFormatsRemoved: number;
  progressiveFormatsRemoved: number;
  audioFormatsKept: number;
  unknownFormatsKept: number;
  /** Somma dei `contentLength` rimossi. Stima, va etichettata come tale nella UI. */
  estimatedBytesSaved: number;
}

/**
 * Uno scostamento fra lo schema atteso e quello osservato.
 * Alimenta il contatore LOCALE di §12. Non lascia mai il dispositivo.
 */
export interface SchemaViolation {
  /** Percorso del campo, es. `streamingData.adaptiveFormats`. */
  path: string;
  /** Cosa ci aspettavamo. */
  expected: string;
  /** Cosa abbiamo trovato (solo il tipo o un enum, MAI il valore: privacy). */
  found: string;
  at: number;
}

export const HOOK_SOURCES = ['property', 'fetch', 'xhr'] as const;
export type HookSource = (typeof HOOK_SOURCES)[number];
