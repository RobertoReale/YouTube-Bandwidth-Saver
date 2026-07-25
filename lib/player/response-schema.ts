/**
 * PLAN.md §6 — parsing difensivo del player response.
 *
 * Nessun accesso diretto tipo `response.streamingData.adaptiveFormats`: ogni
 * lettura passa da qui. In caso di forma inattesa registriamo una
 * `SchemaViolation` e il chiamante fa `applied: false` (fail-open).
 *
 * Type guard scritti a mano, zero dipendenze runtime: lo schema da validare è
 * piccolo e il budget del MAIN world è 15 KB (§11, §13). Vedi RESEARCH.md R8.
 */

import { FIELDS } from '../selectors';
import type { SchemaViolation } from '../types';

/**
 * Una traccia. Tutti i campi sono opzionali: non ci fidiamo di nulla.
 * Solo i campi che leggiamo davvero sono dichiarati; il resto passa intatto
 * grazie a `[key: string]: unknown`.
 */
export interface RawFormat {
  readonly itag?: unknown;
  readonly mimeType?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly fps?: unknown;
  readonly qualityLabel?: unknown;
  readonly audioQuality?: unknown;
  readonly audioSampleRate?: unknown;
  readonly audioChannels?: unknown;
  readonly contentLength?: unknown;
  readonly drmFamilies?: unknown;
  readonly [key: string]: unknown;
}

/** Vista validata e di sola lettura su un player response. */
export interface PlayerResponseView {
  readonly root: Readonly<Record<string, unknown>>;
  readonly streamingData: Readonly<Record<string, unknown>>;
  /** `undefined` se il campo manca; array vuoto se c'era ma vuoto. */
  readonly adaptiveFormats: readonly RawFormat[] | undefined;
  readonly formats: readonly RawFormat[] | undefined;
  readonly isLive: boolean;
  readonly hasDrm: boolean;
  /**
   * SABR attivo: il server decide quali byte mandare e i formati sono solo
   * metadati. Filtrarli non risparmia nulla e rompe la riproduzione.
   */
  readonly hasServerAbr: boolean;
  readonly videoId: string | undefined;
}

export type ParseResult =
  | {
      readonly ok: true;
      readonly view: PlayerResponseView;
      readonly violations: readonly SchemaViolation[];
    }
  | {
      readonly ok: false;
      readonly reason: 'not-a-player-response' | 'no-streaming-data';
      readonly violations: readonly SchemaViolation[];
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Descrive il tipo di un valore senza rivelarne il contenuto (privacy, §13). */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function violation(path: string, expected: string, found: unknown): SchemaViolation {
  return { path, expected, found: describeType(found), at: Date.now() };
}

/** Legge un array di tracce. Restituisce `undefined` se il campo manca. */
function readFormats(
  streamingData: Record<string, unknown>,
  field: string,
  violations: SchemaViolation[],
): readonly RawFormat[] | undefined {
  const raw = streamingData[field];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    violations.push(violation(`streamingData.${field}`, 'array', raw));
    return undefined;
  }
  // Le voci non-oggetto vengono scartate dalla vista ma registrate: se YouTube
  // cambiasse la forma delle tracce, lo vedremmo qui prima che rompa il filtro.
  const out: RawFormat[] = [];
  for (const entry of raw) {
    if (isRecord(entry)) {
      out.push(entry as RawFormat);
    } else {
      violations.push(violation(`streamingData.${field}[]`, 'object', entry));
    }
  }
  return out;
}

function readIsLive(
  root: Record<string, unknown>,
  streamingData: Record<string, unknown>,
): boolean {
  const details = root[FIELDS.videoDetails];
  if (isRecord(details)) {
    if (details.isLive === true || details.isLiveContent === true) return true;
  }
  // I live consegnano un manifest, non `adaptiveFormats` filtrabili (RF-5).
  return (
    typeof streamingData[FIELDS.hlsManifestUrl] === 'string' ||
    typeof streamingData[FIELDS.dashManifestUrl] === 'string'
  );
}

function readHasDrm(
  streamingData: Record<string, unknown>,
  pools: readonly (readonly RawFormat[] | undefined)[],
): boolean {
  if (streamingData[FIELDS.drmParams] !== undefined) return true;
  for (const pool of pools) {
    if (pool === undefined) continue;
    for (const format of pool) {
      if (format[FIELDS.drmFamilies] !== undefined) return true;
    }
  }
  return false;
}

function readVideoId(root: Record<string, unknown>): string | undefined {
  const details = root[FIELDS.videoDetails];
  if (!isRecord(details)) return undefined;
  const id = details.videoId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Valida un valore sconosciuto come player response.
 * Non lancia mai: ogni percorso di errore ha un `reason`.
 */
export function parsePlayerResponse(input: unknown): ParseResult {
  const violations: SchemaViolation[] = [];

  if (!isRecord(input)) {
    return { ok: false, reason: 'not-a-player-response', violations };
  }

  const streamingDataRaw = input[FIELDS.streamingData];
  if (streamingDataRaw === undefined) {
    // Caso legittimo e frequente: pagine non-video, risposte di errore.
    // Non è una violazione di schema.
    return { ok: false, reason: 'no-streaming-data', violations };
  }
  if (!isRecord(streamingDataRaw)) {
    violations.push(violation(FIELDS.streamingData, 'object', streamingDataRaw));
    return { ok: false, reason: 'no-streaming-data', violations };
  }

  const adaptiveFormats = readFormats(streamingDataRaw, FIELDS.adaptiveFormats, violations);
  const formats = readFormats(streamingDataRaw, FIELDS.formats, violations);

  return {
    ok: true,
    violations,
    view: {
      root: input,
      streamingData: streamingDataRaw,
      adaptiveFormats,
      formats,
      isLive: readIsLive(input, streamingDataRaw),
      hasDrm: readHasDrm(streamingDataRaw, [adaptiveFormats, formats]),
      hasServerAbr: streamingDataRaw[FIELDS.serverAbrStreamingUrl] !== undefined,
      videoId: readVideoId(input),
    },
  };
}

/**
 * Euristica veloce: vale la pena fare `JSON.parse` di questo testo?
 * Evita di parsare megabyte di risposte che non c'entrano nulla.
 */
export function looksLikePlayerResponseText(text: string): boolean {
  return text.includes(FIELDS.adaptiveFormats) || text.includes(FIELDS.formats);
}
