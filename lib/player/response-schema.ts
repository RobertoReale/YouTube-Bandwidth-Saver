/**
 * PLAN.md §6 — defensive parsing of player response.
 *
 * No direct access like `response.streamingData.adaptiveFormats`: every
 * read goes through here. In case of unexpected shape we record a
 * `SchemaViolation` and caller sets `applied: false` (fail-open).
 *
 * Handwritten type guards, zero runtime dependencies: schema to validate is
 * small and MAIN world budget is 15 KB (§11, §13). See RESEARCH.md R8.
 */

import { FIELDS } from '../selectors';
import type { SchemaViolation } from '../types';

/**
 * A track. All fields are optional: we trust nothing.
 * Only fields we actually read are declared; rest passes untouched
 * thanks to `[key: string]: unknown`.
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

/** Validated read-only view of a player response. */
export interface PlayerResponseView {
  readonly root: Readonly<Record<string, unknown>>;
  readonly streamingData: Readonly<Record<string, unknown>>;
  /** `undefined` if field is missing; empty array if present but empty. */
  readonly adaptiveFormats: readonly RawFormat[] | undefined;
  readonly formats: readonly RawFormat[] | undefined;
  readonly isLive: boolean;
  readonly hasDrm: boolean;
  /**
   * SABR active: server decides which bytes to send and formats are metadata
   * only. Filtering them saves nothing and breaks playback.
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

/** Describes value type without revealing content (privacy, §13). */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function violation(path: string, expected: string, found: unknown): SchemaViolation {
  return { path, expected, found: describeType(found), at: Date.now() };
}

/** Reads format array. Returns `undefined` if field is missing. */
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
  // Non-object entries discarded from view but logged: if YouTube
  // changes track shape, we will see it here before it breaks filter.
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
  // Live streams deliver a manifest, not filterable `adaptiveFormats` (RF-5).
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
 * Validates unknown value as player response.
 * Never throws: every error path returns a `reason`.
 */
export function parsePlayerResponse(input: unknown): ParseResult {
  const violations: SchemaViolation[] = [];

  if (!isRecord(input)) {
    return { ok: false, reason: 'not-a-player-response', violations };
  }

  const streamingDataRaw = input[FIELDS.streamingData];
  if (streamingDataRaw === undefined) {
    // Legitimate and frequent case: non-video pages, error responses.
    // Not a schema violation.
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
 * Fast heuristic: is it worth running `JSON.parse` on this text?
 * Avoids parsing megabytes of unrelated responses.
 */
export function looksLikePlayerResponseText(text: string): boolean {
  return text.includes(FIELDS.adaptiveFormats) || text.includes(FIELDS.formats);
}
