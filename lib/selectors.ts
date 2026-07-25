/**
 * PLAN.md §12 — TUTTE le stringhe che dipendono da YouTube vivono qui.
 *
 * Regola: se una stringa può cambiare perché YouTube cambia, sta in questo file,
 * con un commento su dove è stata osservata e quando. Quando YouTube cambia
 * qualcosa, la patch è localizzata a questo file.
 *
 * Osservato il 2026-07-25 sullo spike di Fase 0 (Chrome 1xx, www.youtube.com):
 * il player response conteneva `streamingData.adaptiveFormats` (tracce separate)
 * e `streamingData.formats` (progressivi), e gli hook hanno filtrato
 * -4 tracce video / -1 progressivo al primo caricamento e -2 progressivi sulla
 * navigazione SPA.
 */

/** Nomi delle variabili globali che contengono un player response. */
export const PLAYER_RESPONSE_GLOBALS = ['ytInitialPlayerResponse'] as const;

/**
 * Endpoint InnerTube che restituisce un player response.
 * Confrontato con `String.includes`, non con uguaglianza: l'URL reale porta
 * query string variabili (`?key=...&prettyPrint=false`).
 */
export const PLAYER_ENDPOINTS = ['/youtubei/v1/player'] as const;

/** Campi del player response letti da `response-schema.ts`. */
export const FIELDS = {
  streamingData: 'streamingData',
  adaptiveFormats: 'adaptiveFormats',
  formats: 'formats',
  videoDetails: 'videoDetails',
  mimeType: 'mimeType',
  hlsManifestUrl: 'hlsManifestUrl',
  dashManifestUrl: 'dashManifestUrl',
  drmParams: 'drmParams',
  drmFamilies: 'drmFamilies',
  /**
   * ★ Presenza = SABR (Server-Advised Bitrate) attivo.
   *
   * Osservato il 2026-07-25 su www.youtube.com, utente anonimo: `streamingData`
   * conteneva `['expiresInSeconds', 'formats', 'adaptiveFormats',
   * 'serverAbrStreamingUrl']`, e delle 6 tracce ZERO avevano `url` e ZERO
   * `signatureCipher`. I formati sono solo metadati: la riproduzione passa dal
   * server. Filtrarli lato client rompe il player (403 su `videoplayback`).
   * Vedi RESEARCH.md R1.
   */
  serverAbrStreamingUrl: 'serverAbrStreamingUrl',
} as const;

/**
 * Livelli di qualità del player YouTube, dal più leggero al più pesante.
 * Stringhe dell'API del player, quindi dipendenti da YouTube.
 * `tiny` è 144p. `auto` è escluso di proposito: è ciò che vogliamo evitare.
 */
export const QUALITY_LEVELS = [
  'tiny',
  'small',
  'medium',
  'large',
  'hd720',
  'hd1080',
  'hd1440',
  'hd2160',
  'hd2880',
  'highres',
] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/** Eventi custom emessi da YouTube (SPA). Usati dal mondo ISOLATED. */
export const YT_EVENTS = {
  /** Fine di una navigazione SPA. Osservato stabile da anni. */
  navigateFinish: 'yt-navigate-finish',
} as const;

/**
 * Selettori DOM. Ogni voce è una catena di fallback provata in ordine.
 * Non usati in Fase 1 (nessuna UI nel player): servono dalla Fase 2, RF-3.
 */
export const DOM = {
  rightControls: ['.ytp-right-controls'],
  settingsButton: ['.ytp-settings-button'],
  moviePlayer: ['#movie_player'],
  video: ['video.html5-main-video', 'video'],
} as const;

/** Host su cui l'estensione opera. Deve restare allineato a `host_permissions`. */
export const SUPPORTED_HOSTS = ['www.youtube.com', 'music.youtube.com'] as const;
