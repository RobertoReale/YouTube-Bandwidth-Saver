import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyFormat, filterPlayerResponse } from '../../lib/player/format-filter';
import type { RawFormat } from '../../lib/player/response-schema';

/** Fixtures are loaded as `unknown`: that's how they arrive from player. */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function formatsOf(response: unknown, field: 'adaptiveFormats' | 'formats'): RawFormat[] {
  const streamingData = (response as { streamingData: Record<string, unknown> }).streamingData;
  return (streamingData[field] ?? []) as RawFormat[];
}

describe('classifyFormat', () => {
  it('recognizes video from mimeType', () => {
    expect(classifyFormat({ mimeType: 'video/mp4; codecs="avc1"' })).toBe('video');
  });

  it('recognizes audio from mimeType', () => {
    expect(classifyFormat({ mimeType: 'audio/webm; codecs="opus"' })).toBe('audio');
  });

  it.each([
    ['width', { width: 1920 }],
    ['height', { height: 1080 }],
    ['fps', { fps: 60 }],
    ['qualityLabel', { qualityLabel: '720p' }],
  ])('classifies as video on sole signal %s, without mimeType', (_name, format) => {
    expect(classifyFormat(format)).toBe('video');
  });

  it.each([
    ['audioQuality', { audioQuality: 'AUDIO_QUALITY_LOW' }],
    ['audioSampleRate string', { audioSampleRate: '44100' }],
    ['audioSampleRate number', { audioSampleRate: 44100 }],
    ['audioChannels', { audioChannels: 2 }],
  ])('classifies as audio on sole signal %s', (_name, format) => {
    expect(classifyFormat(format)).toBe('audio');
  });

  it('video signals win over audio ones: progressive format is video', () => {
    // If we classified it as audio, player would fall back to a
    // progressive format and download video anyway.
    expect(
      classifyFormat({
        mimeType: 'video/mp4; codecs="avc1, mp4a"',
        width: 640,
        audioQuality: 'AUDIO_QUALITY_LOW',
      }),
    ).toBe('video');
  });

  it('an unknown mimeType does not decide on its own', () => {
    expect(classifyFormat({ mimeType: 'application/x-mpegurl' })).toBe('unknown');
  });

  it('uses itags only as last signal', () => {
    const options = { audioItags: new Set([999]), videoItags: new Set([998]) };
    expect(classifyFormat({ itag: 999 }, options)).toBe('audio');
    expect(classifyFormat({ itag: 998 }, options)).toBe('video');
    // mimeType takes precedence over itag.
    expect(classifyFormat({ itag: 999, mimeType: 'video/mp4' }, options)).toBe('video');
    // Itag not in table, and no default table.
    expect(classifyFormat({ itag: 137 }, options)).toBe('unknown');
    expect(classifyFormat({ itag: 137 })).toBe('unknown');
  });

  it('does not classify anything on empty object or invalid type fields', () => {
    expect(classifyFormat({})).toBe('unknown');
    expect(classifyFormat({ mimeType: 42, width: 'large', itag: 'x' })).toBe('unknown');
  });
});

describe('filterPlayerResponse — normal video', () => {
  it('removes video tracks and keeps audio ones', () => {
    const input = fixture('normal-video');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.videoId).toBe('FIXTURE_NORMAL');
    expect(result.isLive).toBe(false);

    const adaptive = formatsOf(result.response, 'adaptiveFormats');
    expect(adaptive).toHaveLength(2);
    expect(adaptive.every((f) => String(f.mimeType).startsWith('audio/'))).toBe(true);
    expect(adaptive.map((f) => f.itag)).toEqual([140, 251]);
  });

  it('empties progressive formats as well, otherwise player falls back to them', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(formatsOf(result.response, 'formats')).toHaveLength(0);
  });

  it('correctly counts stats', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(result.stats).toEqual({
      videoFormatsRemoved: 2,
      progressiveFormatsRemoved: 1,
      audioFormatsKept: 2,
      unknownFormatsKept: 0,
      // 104857600 + 83886080 (adaptive) + 12345678 (progressive)
      estimatedBytesSaved: 104857600 + 83886080 + 12345678,
    });
  });

  it('preserves fields that do not concern us', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    const response = result.response as Record<string, unknown>;
    expect(response.playabilityStatus).toEqual({ status: 'OK' });
    expect(response.videoDetails).toBeDefined();
    expect((response.streamingData as Record<string, unknown>).expiresInSeconds).toBe('21540');
  });

  it('does NOT mutate input', () => {
    const input = fixture('normal-video');
    const snapshot = JSON.stringify(input);
    const result = filterPlayerResponse(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.response).not.toBe(input);
  });

  it('is idempotent: on second pass there is nothing left to remove', () => {
    const once = filterPlayerResponse(fixture('normal-video'));
    const twice = filterPlayerResponse(once.response);

    expect(twice.applied).toBe(false);
    expect(twice.reason).toBe('no-video-formats');
    expect(twice.response).toBe(once.response);
    expect(formatsOf(once.response, 'adaptiveFormats')).toHaveLength(2);
  });
});

describe('filterPlayerResponse — fail-open', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'not a player response'],
    ['array', [1, 2, 3]],
    ['empty object', {}],
  ])('returns untouched input on %s', (_name, input) => {
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.response).toBe(input);
    expect(result.stats.videoFormatsRemoved).toBe(0);
  });

  it('an empty object is "no-streaming-data", not a schema violation', () => {
    const result = filterPlayerResponse({});
    expect(result.reason).toBe('no-streaming-data');
    expect(result.violations).toHaveLength(0);
  });

  it('a non-object is "not-a-player-response"', () => {
    expect(filterPlayerResponse(null).reason).toBe('not-a-player-response');
    expect(filterPlayerResponse([]).reason).toBe('not-a-player-response');
  });

  it('records a violation if streamingData is not an object', () => {
    const result = filterPlayerResponse({ streamingData: 'surprise' });
    expect(result.reason).toBe('no-streaming-data');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      path: 'streamingData',
      expected: 'object',
      found: 'string',
    });
  });

  it('records a violation if adaptiveFormats is not an array', () => {
    const result = filterPlayerResponse({ streamingData: { adaptiveFormats: { 0: {} } } });
    expect(result.applied).toBe(false);
    expect(result.violations[0]).toMatchObject({
      path: 'streamingData.adaptiveFormats',
      expected: 'array',
      found: 'object',
    });
  });

  it('discards non-object entries inside arrays and records them', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [
          null,
          'track',
          { mimeType: 'video/mp4', contentLength: '100' },
          { mimeType: 'audio/mp4' },
        ],
      },
    });
    expect(result.applied).toBe(true);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.found)).toEqual(['null', 'string']);
    expect(formatsOf(result.response, 'adaptiveFormats')).toHaveLength(1);
  });

  it('never throws, even if reading a field throws', () => {
    const hostile = {
      get streamingData(): never {
        throw new Error('boom');
      },
    };
    const result = filterPlayerResponse(hostile);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('internal-error');
    expect(result.response).toBe(hostile);
  });

  it('a truncated and re-parsed JSON remains manageable', () => {
    // Simulates what arrives if body was truncated: missing fields.
    const result = filterPlayerResponse({ streamingData: {} });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-video-formats');
  });
});

describe('filterPlayerResponse — critical guard on zero audio tracks', () => {
  it('cancels everything if no audio track would remain', () => {
    const input = fixture('video-only-no-audio');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
    // ★ Untouched input is returned: without this guard video would be
    //   unplayable on any YouTube mimeType change.
    expect(result.response).toBe(input);
    expect(formatsOf(result.response, 'adaptiveFormats')).toHaveLength(2);
  });

  it('unknown tracks DO NOT count as audio', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { itag: 12345 }],
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
  });

  it('but unknown tracks ARE KEPT when filter applies', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }, { itag: 12345 }],
      },
    });
    expect(result.applied).toBe(true);
    expect(result.stats.unknownFormatsKept).toBe(1);
    expect(formatsOf(result.response, 'adaptiveFormats')).toHaveLength(2);
  });
});

describe('★ filterPlayerResponse — SABR guard (RESEARCH.md R1)', () => {
  /**
   * Observed on 2026-07-25: with `serverAbrStreamingUrl` present tracks have
   * no URLs, playback relies on server, and filtering them causes 403 on
   * `videoplayback` with "Your browser can't play this video".
   */
  it('gives up when streamingData contains serverAbrStreamingUrl', () => {
    const input = fixture('server-abr');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('server-abr');
    expect(result.response).toBe(input);
    expect(result.videoId).toBe('FIXTURE_SABR');
  });

  it('guard fires even if tracks appear filterable', () => {
    // Point: apparent filterability doesn't matter. If SABR present, give up.
    const result = filterPlayerResponse({
      streamingData: {
        serverAbrStreamingUrl: 'https://example.invalid/abr',
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }],
        formats: [{ mimeType: 'video/mp4' }],
      },
    });
    expect(result.reason).toBe('server-abr');
    expect(result.stats.videoFormatsRemoved).toBe(0);
  });

  it('guard precedes DRM guard: SABR is more general condition', () => {
    const result = filterPlayerResponse({
      streamingData: {
        serverAbrStreamingUrl: 'https://example.invalid/abr',
        drmParams: 'x',
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }],
      },
    });
    expect(result.reason).toBe('server-abr');
  });

  it('does NOT fire on live streams, which have their own skip reason', () => {
    const result = filterPlayerResponse({
      videoDetails: { isLive: true },
      streamingData: {
        serverAbrStreamingUrl: 'https://example.invalid/abr',
        adaptiveFormats: [{ mimeType: 'audio/mp4' }],
      },
    });
    expect(result.reason).toBe('live-stream');
  });

  it('without SABR filter works as before', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(result.applied).toBe(true);
  });
});

describe('filterPlayerResponse — cases that should not be touched', () => {
  it('skips live streams detected by videoDetails.isLive and HLS manifest', () => {
    const input = fixture('live-stream');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('live-stream');
    expect(result.isLive).toBe(true);
    expect(result.videoId).toBe('FIXTURE_LIVE');
    expect(result.response).toBe(input);
  });

  it.each([
    [
      'isLiveContent',
      { videoDetails: { isLiveContent: true }, streamingData: { adaptiveFormats: [] } },
    ],
    ['dashManifestUrl', { streamingData: { dashManifestUrl: 'https://example.invalid/m.mpd' } }],
    ['hlsManifestUrl', { streamingData: { hlsManifestUrl: 'https://example.invalid/m.m3u8' } }],
  ])('detects live stream from %s as well', (_name, input) => {
    expect(filterPlayerResponse(input).reason).toBe('live-stream');
  });

  it('skips DRM protected content', () => {
    const input = fixture('drm-protected');
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('drm-protected');
    expect(result.response).toBe(input);
  });

  it('detects DRM from sole drmFamilies on a track', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4', drmFamilies: ['WIDEVINE'] }],
        formats: [{ mimeType: 'video/mp4' }],
      },
    });
    expect(result.reason).toBe('drm-protected');
  });

  it('detects DRM from drmFamilies present only in progressives', () => {
    const result = filterPlayerResponse({
      streamingData: { formats: [{ mimeType: 'video/mp4', drmFamilies: [] }] },
    });
    expect(result.reason).toBe('drm-protected');
  });

  it('does nothing if there are no video tracks to remove', () => {
    const input = fixture('already-audio-only');
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-video-formats');
    expect(result.response).toBe(input);
  });

  it('does nothing on a response without streamingData', () => {
    const result = filterPlayerResponse(fixture('no-streaming-data'));
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-streaming-data');
    expect(result.videoId).toBeUndefined();
  });
});

describe('filterPlayerResponse — partially present arrays', () => {
  it('works with only adaptiveFormats, without formats', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }],
      },
    });
    expect(result.applied).toBe(true);
    const streamingData = (result.response as { streamingData: Record<string, unknown> })
      .streamingData;
    // Missing field stays missing: we don't invent an empty one.
    expect('formats' in streamingData).toBe(false);
    expect(result.stats.progressiveFormatsRemoved).toBe(0);
  });

  it('with only progressive formats audio guard triggers', () => {
    // No `adaptiveFormats` → no audio track to keep → cancels.
    const input = { streamingData: { formats: [{ mimeType: 'video/mp4' }] } };
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
    expect(result.response).toBe(input);
  });
});

describe('filterPlayerResponse — byte estimation', () => {
  it.each([
    ['numeric string', '1024', 1024],
    ['number', 2048, 2048],
    ['non-numeric string', 'many', 0],
    ['empty string', '', 0],
    ['zero', '0', 0],
    ['negative', '-5', 0],
    ['negative number', -5, 0],
    ['not finite', Number.POSITIVE_INFINITY, 0],
    ['missing', undefined, 0],
    ['object', { bytes: 10 }, 0],
  ])('interprets contentLength %s', (_name, contentLength, expected) => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4', contentLength }, { mimeType: 'audio/mp4' }],
      },
    });
    expect(result.stats.estimatedBytesSaved).toBe(expected);
  });
});

describe('filterPlayerResponse — videoId', () => {
  it.each([
    ['videoDetails missing', { streamingData: {} }, undefined],
    ['videoDetails not object', { videoDetails: 'x', streamingData: {} }, undefined],
    ['videoId not string', { videoDetails: { videoId: 42 }, streamingData: {} }, undefined],
    ['valid videoId', { videoDetails: { videoId: 'abc' }, streamingData: {} }, 'abc'],
  ])('reads videoId: %s', (_name, input, expected) => {
    expect(filterPlayerResponse(input).videoId).toBe(expected);
  });
});
