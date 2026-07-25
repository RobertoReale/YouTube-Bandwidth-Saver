/**
 * PLAN.md §6 — il cuore. Funzione pura, nessuna dipendenza dal browser.
 *
 * Regole non negoziabili implementate qui:
 *  1. Mai mutare l'input (copia strutturata solo del percorso toccato).
 *  2. Fail-open: in dubbio, si restituisce l'input intatto con `applied: false`.
 *  3. Guardia sulle zero tracce: se dopo il filtro non resta audio, si annulla.
 *  4. Più segnali per distinguere video da audio, non solo `mimeType`.
 */

import { FIELDS } from '../selectors';
import type { FilterStats, SchemaViolation, SkipReason } from '../types';
import { type PlayerResponseView, parsePlayerResponse, type RawFormat } from './response-schema';

export type TrackKind = 'audio' | 'video' | 'unknown';

export interface FilterOptions {
  /**
   * Itag noti, usati SOLO come ultimo segnale quando `mimeType` e le dimensioni
   * mancano. Vuoto per default: popolarlo richiede RESEARCH.md R5, e una tabella
   * inventata sarebbe peggio dell'assenza di tabella (classificherebbe male).
   */
  readonly audioItags?: ReadonlySet<number>;
  readonly videoItags?: ReadonlySet<number>;
}

export interface FilterResult {
  /** Il player response da consegnare al player. `=== input` se non applicato. */
  readonly response: unknown;
  readonly applied: boolean;
  readonly reason?: SkipReason;
  readonly stats: FilterStats;
  readonly violations: readonly SchemaViolation[];
  readonly videoId: string | undefined;
  readonly isLive: boolean;
}

const EMPTY_STATS: FilterStats = {
  videoFormatsRemoved: 0,
  progressiveFormatsRemoved: 0,
  audioFormatsKept: 0,
  unknownFormatsKept: 0,
  estimatedBytesSaved: 0,
};

function skip(
  input: unknown,
  reason: SkipReason,
  violations: readonly SchemaViolation[] = [],
  extra: { videoId?: string | undefined; isLive?: boolean } = {},
): FilterResult {
  return {
    response: input,
    applied: false,
    reason,
    stats: EMPTY_STATS,
    violations,
    videoId: extra.videoId,
    isLive: extra.isLive ?? false,
  };
}

/**
 * Classifica una traccia con più segnali indipendenti.
 *
 * I segnali video vincono su quelli audio: un formato progressivo (video+audio
 * combinati, es. `formats`) ha sia `width` sia `audioQuality`, e va rimosso —
 * altrimenti il player ripiegherebbe su quello e scaricherebbe video comunque.
 */
export function classifyFormat(format: RawFormat, options: FilterOptions = {}): TrackKind {
  const mimeType = format[FIELDS.mimeType];
  if (typeof mimeType === 'string') {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
  }

  // Segnali dimensionali: solo una traccia video ha larghezza, altezza o fps.
  if (
    typeof format.width === 'number' ||
    typeof format.height === 'number' ||
    typeof format.fps === 'number' ||
    typeof format.qualityLabel === 'string'
  ) {
    return 'video';
  }

  // Segnali audio-specifici.
  if (
    typeof format.audioQuality === 'string' ||
    typeof format.audioSampleRate === 'string' ||
    typeof format.audioSampleRate === 'number' ||
    typeof format.audioChannels === 'number'
  ) {
    return 'audio';
  }

  // Ultimo segnale: itag noto (vuoto per default, vedi FilterOptions).
  const itag = format.itag;
  if (typeof itag === 'number') {
    if (options.videoItags?.has(itag)) return 'video';
    if (options.audioItags?.has(itag)) return 'audio';
  }

  return 'unknown';
}

function parseContentLength(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

interface Partitioned {
  readonly kept: RawFormat[];
  readonly removed: RawFormat[];
  readonly audioKept: number;
  readonly unknownKept: number;
  readonly bytesRemoved: number;
}

/**
 * Divide una lista di tracce in "da tenere" e "da rimuovere".
 * Le tracce `unknown` vengono TENUTE: non rimuoviamo ciò che non capiamo.
 * Al massimo l'estensione è inefficace, che è sempre meglio di YouTube rotto.
 */
function partition(formats: readonly RawFormat[], options: FilterOptions): Partitioned {
  const kept: RawFormat[] = [];
  const removed: RawFormat[] = [];
  let audioKept = 0;
  let unknownKept = 0;
  let bytesRemoved = 0;

  for (const format of formats) {
    const kind = classifyFormat(format, options);
    if (kind === 'video') {
      removed.push(format);
      bytesRemoved += parseContentLength(format.contentLength);
      continue;
    }
    kept.push(format);
    if (kind === 'audio') audioKept++;
    else unknownKept++;
  }

  return { kept, removed, audioKept, unknownKept, bytesRemoved };
}

function buildResponse(
  view: PlayerResponseView,
  adaptive: readonly RawFormat[] | undefined,
  progressive: readonly RawFormat[] | undefined,
): unknown {
  // Copia strutturata del solo percorso toccato: l'input non viene mai mutato,
  // e non paghiamo un deep clone di un oggetto che può essere di megabyte.
  const streamingData: Record<string, unknown> = { ...view.streamingData };
  if (adaptive !== undefined) streamingData[FIELDS.adaptiveFormats] = adaptive;
  if (progressive !== undefined) streamingData[FIELDS.formats] = progressive;
  return { ...view.root, [FIELDS.streamingData]: streamingData };
}

/**
 * Rimuove le tracce video da un player response.
 * Non lancia mai: qualunque input produce un `FilterResult` valido.
 */
export function filterPlayerResponse(input: unknown, options: FilterOptions = {}): FilterResult {
  try {
    const parsed = parsePlayerResponse(input);
    if (!parsed.ok) return skip(input, parsed.reason, parsed.violations);

    const { view } = parsed;

    // RF-5: i live usano un manifest, non tracce filtrabili. Fail-open esplicito.
    if (view.isLive) {
      return skip(input, 'live-stream', parsed.violations, {
        videoId: view.videoId,
        isLive: true,
      });
    }

    // ★ Guardia SABR — la più importante di tutte, verificata sul campo il
    //   2026-07-25 (RESEARCH.md R1).
    //
    //   Quando `streamingData` contiene `serverAbrStreamingUrl`, le tracce non
    //   hanno URL: sono metadati, e la riproduzione passa interamente dal
    //   server. Rimuoverle non risparmia un byte e rende incoerente la
    //   richiesta che il player costruisce → 403 su `videoplayback` e
    //   "Your browser can't play this video".
    //
    //   Senza questa guardia l'estensione ROMPE YouTube invece di alleggerirlo,
    //   che è l'unico esito che il progetto considera inaccettabile.
    //   Il risparmio, sotto SABR, si ottiene forzando la qualità minima
    //   (`lib/player/quality.ts`), non filtrando qui.
    if (view.hasServerAbr) {
      return skip(input, 'server-abr', parsed.violations, { videoId: view.videoId });
    }

    // I contenuti protetti non si toccano: il player ha percorsi propri e il
    // rischio di romperli non vale il risparmio.
    if (view.hasDrm) {
      return skip(input, 'drm-protected', parsed.violations, { videoId: view.videoId });
    }

    const adaptive = view.adaptiveFormats ? partition(view.adaptiveFormats, options) : undefined;
    const progressive = view.formats ? partition(view.formats, options) : undefined;

    const videoRemoved = adaptive?.removed.length ?? 0;
    const progressiveRemoved = progressive?.removed.length ?? 0;

    if (videoRemoved === 0 && progressiveRemoved === 0) {
      // Niente da rimuovere: già audio-only, oppure lo schema non è quello che
      // crediamo. In entrambi i casi restituire l'input intatto è corretto.
      return skip(input, 'no-video-formats', parsed.violations, { videoId: view.videoId });
    }

    // ★ Guardia critica (§6). Senza questa, un cambiamento nel `mimeType` di
    //   YouTube renderebbe ogni video non riproducibile.
    //
    //   Il controllo su `adaptive === undefined` non è ridondante: un player
    //   response con soli `formats` progressivi non ha nessuna traccia audio
    //   separata da tenere. Superata questa guardia, `adaptive` è definito —
    //   il che rende il resto della funzione privo di rami irraggiungibili.
    if (adaptive === undefined || adaptive.audioKept === 0) {
      return skip(input, 'no-audio-formats', parsed.violations, { videoId: view.videoId });
    }

    return {
      response: buildResponse(view, adaptive.kept, progressive?.kept),
      applied: true,
      stats: {
        videoFormatsRemoved: videoRemoved,
        progressiveFormatsRemoved: progressiveRemoved,
        audioFormatsKept: adaptive.audioKept,
        unknownFormatsKept: adaptive.unknownKept + (progressive?.unknownKept ?? 0),
        estimatedBytesSaved: adaptive.bytesRemoved + (progressive?.bytesRemoved ?? 0),
      },
      violations: parsed.violations,
      videoId: view.videoId,
      isLive: false,
    };
  } catch {
    // Rete di sicurezza finale: qualunque eccezione imprevista restituisce
    // l'input intatto. Meglio l'estensione inefficace che YouTube rotto.
    return skip(input, 'internal-error');
  }
}
