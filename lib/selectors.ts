/**
 * PLAN.md §12 — ALL strings that depend on YouTube live here.
 *
 * Rule: if a string can change because YouTube changes, it lives in this file,
 * with a comment on where and when it was observed. When YouTube changes
 * something, the patch is localized to this file.
 *
 * Observed on 2026-07-25 during Phase 0 spike (Chrome 1xx, www.youtube.com):
 * player response contained `streamingData.adaptiveFormats` (separate tracks)
 * and `streamingData.formats` (progressive), and hooks filtered out
 * -4 video tracks / -1 progressive on first load and -2 progressive on
 * SPA navigation.
 */

/**
 * Quality levels of YouTube player, from lightest to heaviest.
 * Player API strings, thus dependent on YouTube.
 * `tiny` is 144p. `auto` is intentionally excluded: it is what we want to avoid.
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

/** Custom events emitted by YouTube (SPA). Used by ISOLATED world. */
export const YT_EVENTS = {
  /** End of SPA navigation. Observed stable for years. */
  navigateFinish: 'yt-navigate-finish',
} as const;

/**
 * DOM Selectors. Each entry is a chain of fallbacks tried in order.
 * Not used in Phase 1 (no UI in player): needed from Phase 2, RF-3.
 */
export const DOM = {
  rightControls: ['.ytp-right-controls'],
  settingsButton: ['.ytp-settings-button'],
  moviePlayer: ['#movie_player'],
  video: ['video.html5-main-video', 'video'],
} as const;

/** Hosts on which extension operates. Must stay aligned with `host_permissions`. */
export const SUPPORTED_HOSTS = ['www.youtube.com', 'music.youtube.com'] as const;
