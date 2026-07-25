/**
 * PLAN.md §6 — the core. Pure function, no browser dependencies.
 *
 * Non-negotiable rules implemented here:
 *  1. Never mutate input (structured copy of modified path only).
 *  2. Fail-open: when in doubt, return untouched input with `applied: false`.
 *  3. Zero-track guard: if no audio remains after filter, cancel.
 *  4. Multiple signals to distinguish video from audio, not just `mimeType`.
 */

import { FIELDS } from '../selectors';
import type { FilterStats, SchemaViolation, SkipReason } from '../types';
import { type PlayerResponseView, parsePlayerResponse, type RawFormat } from './response-schema';

export type TrackKind = 'audio' | 'video' | 'unknown';

export interface FilterOptions {
  /**
   * Known itags, used ONLY as last signal when `mimeType` and dimensions
   * are missing. Empty by default: populating requires RESEARCH.md R5, and an
   * invented table would be worse than no table (misclassifying).
   */
  readonly audioItags?: ReadonlySet<number>;
  readonly videoItags?: ReadonlySet<number>;
}

export interface FilterResult {
  /** Player response to deliver to player. `=== input` if not applied. */
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
 * Classifies a track using multiple independent signals.
 *
 * Video signals take priority over audio ones: a progressive format (combined video+audio,
 * e.g., `formats`) has both `width` and `audioQuality`, and must be removed —
 * otherwise player would fall back to it and download video anyway.
 */
export function classifyFormat(format: RawFormat, options: FilterOptions = {}): TrackKind {
  const mimeType = format[FIELDS.mimeType];
  if (typeof mimeType === 'string') {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
  }

  // Dimensional signals: only a video track has width, height, or fps.
  if (
    typeof format.width === 'number' ||
    typeof format.height === 'number' ||
    typeof format.fps === 'number' ||
    typeof format.qualityLabel === 'string'
  ) {
    return 'video';
  }

  // Audio-specific signals.
  if (
    typeof format.audioQuality === 'string' ||
    typeof format.audioSampleRate === 'string' ||
    typeof format.audioSampleRate === 'number' ||
    typeof format.audioChannels === 'number'
  ) {
    return 'audio';
  }

  // Last signal: known itag (empty by default, see FilterOptions).
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
 * Splits a list of tracks into "to keep" and "to remove".
 * `unknown` tracks are KEPT: we do not remove what we do not understand.
 * At worst the extension is ineffective, which is always better than broken YouTube.
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
  // Structured copy of modified path only: input is never mutated,
  // and we don't pay deep clone cost for an object that might be megabytes.
  const streamingData: Record<string, unknown> = { ...view.streamingData };
  if (adaptive !== undefined) streamingData[FIELDS.adaptiveFormats] = adaptive;
  if (progressive !== undefined) streamingData[FIELDS.formats] = progressive;
  return { ...view.root, [FIELDS.streamingData]: streamingData };
}

/**
 * Removes video tracks from a player response.
 * Never throws: any input produces a valid `FilterResult`.
 */
export function filterPlayerResponse(input: unknown, options: FilterOptions = {}): FilterResult {
  try {
    const parsed = parsePlayerResponse(input);
    if (!parsed.ok) return skip(input, parsed.reason, parsed.violations);

    const { view } = parsed;

    // RF-5: live streams use a manifest, not filterable tracks. Explicit fail-open.
    if (view.isLive) {
      return skip(input, 'live-stream', parsed.violations, {
        videoId: view.videoId,
        isLive: true,
      });
    }

    // ★ SABR Guard — most important of all, verified in field on
    //   2026-07-25 (RESEARCH.md R1).
    //
    //   When `streamingData` contains `serverAbrStreamingUrl`, tracks have
    //   no URLs: they are metadata, and playback goes entirely through
    //   server. Removing them saves zero bytes and makes request built
    //   by player inconsistent → 403 on `videoplayback` and
    //   "Your browser can't play this video".
    //
    //   Without this guard extension BREAKS YouTube instead of saving bandwidth,
    //   which is the single outcome this project considers unacceptable.
    //   Under SABR, savings are achieved by forcing minimal quality
    //   (`lib/player/quality.ts`), not by filtering here.
    if (view.hasServerAbr) {
      return skip(input, 'server-abr', parsed.violations, { videoId: view.videoId });
    }

    // Protected content is left untouched: player has custom flows and
    // risk of breaking them isn't worth potential bandwidth savings.
    if (view.hasDrm) {
      return skip(input, 'drm-protected', parsed.violations, { videoId: view.videoId });
    }

    const adaptive = view.adaptiveFormats ? partition(view.adaptiveFormats, options) : undefined;
    const progressive = view.formats ? partition(view.formats, options) : undefined;

    const videoRemoved = adaptive?.removed.length ?? 0;
    const progressiveRemoved = progressive?.removed.length ?? 0;

    if (videoRemoved === 0 && progressiveRemoved === 0) {
      // Nothing to remove: already audio-only, or schema is not what we think.
      // In both cases returning untouched input is correct.
      return skip(input, 'no-video-formats', parsed.violations, { videoId: view.videoId });
    }

    // ★ Critical Guard (§6). Without this, a change in YouTube's `mimeType`
    //   would make every video unplayable.
    //
    //   Check for `adaptive === undefined` is not redundant: a player
    //   response with only progressive `formats` has no separate audio tracks to keep.
    //   Once past this guard, `adaptive` is defined.
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
    // Ultimate safety net: any unexpected exception returns untouched input.
    // Ineffective extension is better than broken YouTube.
    return skip(input, 'internal-error');
  }
}
