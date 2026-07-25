import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyFormat, filterPlayerResponse } from '../../lib/player/format-filter';
import type { RawFormat } from '../../lib/player/response-schema';

/** Le fixture si caricano come `unknown`: è così che arrivano dal player. */
function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function formatsOf(response: unknown, field: 'adaptiveFormats' | 'formats'): RawFormat[] {
  const streamingData = (response as { streamingData: Record<string, unknown> }).streamingData;
  return (streamingData[field] ?? []) as RawFormat[];
}

describe('classifyFormat', () => {
  it('riconosce il video dal mimeType', () => {
    expect(classifyFormat({ mimeType: 'video/mp4; codecs="avc1"' })).toBe('video');
  });

  it("riconosce l'audio dal mimeType", () => {
    expect(classifyFormat({ mimeType: 'audio/webm; codecs="opus"' })).toBe('audio');
  });

  it.each([
    ['width', { width: 1920 }],
    ['height', { height: 1080 }],
    ['fps', { fps: 60 }],
    ['qualityLabel', { qualityLabel: '720p' }],
  ])('classifica come video sul solo segnale %s, senza mimeType', (_name, format) => {
    expect(classifyFormat(format)).toBe('video');
  });

  it.each([
    ['audioQuality', { audioQuality: 'AUDIO_QUALITY_LOW' }],
    ['audioSampleRate stringa', { audioSampleRate: '44100' }],
    ['audioSampleRate numero', { audioSampleRate: 44100 }],
    ['audioChannels', { audioChannels: 2 }],
  ])('classifica come audio sul solo segnale %s', (_name, format) => {
    expect(classifyFormat(format)).toBe('audio');
  });

  it('i segnali video vincono su quelli audio: un progressivo è video', () => {
    // Se lo classificassimo audio, il player ripiegherebbe su un formato
    // progressivo e scaricherebbe video comunque.
    expect(
      classifyFormat({
        mimeType: 'video/mp4; codecs="avc1, mp4a"',
        width: 640,
        audioQuality: 'AUDIO_QUALITY_LOW',
      }),
    ).toBe('video');
  });

  it('un mimeType di tipo sconosciuto non decide da solo', () => {
    expect(classifyFormat({ mimeType: 'application/x-mpegurl' })).toBe('unknown');
  });

  it('usa gli itag solo come ultimo segnale', () => {
    const options = { audioItags: new Set([999]), videoItags: new Set([998]) };
    expect(classifyFormat({ itag: 999 }, options)).toBe('audio');
    expect(classifyFormat({ itag: 998 }, options)).toBe('video');
    // Il mimeType ha la precedenza sull'itag.
    expect(classifyFormat({ itag: 999, mimeType: 'video/mp4' }, options)).toBe('video');
    // Itag non in tabella, e nessuna tabella per default.
    expect(classifyFormat({ itag: 137 }, options)).toBe('unknown');
    expect(classifyFormat({ itag: 137 })).toBe('unknown');
  });

  it('non classifica nulla su un oggetto vuoto o con campi di tipo errato', () => {
    expect(classifyFormat({})).toBe('unknown');
    expect(classifyFormat({ mimeType: 42, width: 'grande', itag: 'x' })).toBe('unknown');
  });
});

describe('filterPlayerResponse — video normale', () => {
  it('rimuove le tracce video e tiene quelle audio', () => {
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

  it('svuota anche i formati progressivi, altrimenti il player ripiega su quelli', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(formatsOf(result.response, 'formats')).toHaveLength(0);
  });

  it('conta correttamente le statistiche', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(result.stats).toEqual({
      videoFormatsRemoved: 2,
      progressiveFormatsRemoved: 1,
      audioFormatsKept: 2,
      unknownFormatsKept: 0,
      // 104857600 + 83886080 (adattivi) + 12345678 (progressivo)
      estimatedBytesSaved: 104857600 + 83886080 + 12345678,
    });
  });

  it('preserva i campi che non ci riguardano', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    const response = result.response as Record<string, unknown>;
    expect(response.playabilityStatus).toEqual({ status: 'OK' });
    expect(response.videoDetails).toBeDefined();
    expect((response.streamingData as Record<string, unknown>).expiresInSeconds).toBe('21540');
  });

  it("NON muta l'input", () => {
    const input = fixture('normal-video');
    const snapshot = JSON.stringify(input);
    const result = filterPlayerResponse(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.response).not.toBe(input);
  });

  it("è idempotente: al secondo giro non c'è più nulla da rimuovere", () => {
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
    ['numero', 42],
    ['stringa', 'non sono un player response'],
    ['array', [1, 2, 3]],
    ['oggetto vuoto', {}],
  ])("restituisce l'input intatto su %s", (_name, input) => {
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.response).toBe(input);
    expect(result.stats.videoFormatsRemoved).toBe(0);
  });

  it('un oggetto vuoto è "no-streaming-data", non una violazione di schema', () => {
    const result = filterPlayerResponse({});
    expect(result.reason).toBe('no-streaming-data');
    expect(result.violations).toHaveLength(0);
  });

  it('un non-oggetto è "not-a-player-response"', () => {
    expect(filterPlayerResponse(null).reason).toBe('not-a-player-response');
    expect(filterPlayerResponse([]).reason).toBe('not-a-player-response');
  });

  it('registra una violazione se streamingData non è un oggetto', () => {
    const result = filterPlayerResponse({ streamingData: 'sorpresa' });
    expect(result.reason).toBe('no-streaming-data');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      path: 'streamingData',
      expected: 'object',
      found: 'string',
    });
  });

  it('registra una violazione se adaptiveFormats non è un array', () => {
    const result = filterPlayerResponse({ streamingData: { adaptiveFormats: { 0: {} } } });
    expect(result.applied).toBe(false);
    expect(result.violations[0]).toMatchObject({
      path: 'streamingData.adaptiveFormats',
      expected: 'array',
      found: 'object',
    });
  });

  it('scarta le voci non-oggetto dentro gli array e le registra', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [
          null,
          'traccia',
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

  it('non lancia mai, nemmeno se leggere un campo lancia', () => {
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

  it('un JSON troncato e riparsato resta gestibile', () => {
    // Simula ciò che arriva se il body è stato tagliato: campi mancanti.
    const result = filterPlayerResponse({ streamingData: {} });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-video-formats');
  });
});

describe('filterPlayerResponse — la guardia critica sulle zero tracce audio', () => {
  it('annulla tutto se non resterebbe nessuna traccia audio', () => {
    const input = fixture('video-only-no-audio');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
    // ★ L'input torna intatto: senza questa guardia il video sarebbe
    //   irriproducibile a ogni cambiamento del mimeType di YouTube.
    expect(result.response).toBe(input);
    expect(formatsOf(result.response, 'adaptiveFormats')).toHaveLength(2);
  });

  it('le tracce sconosciute NON contano come audio', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { itag: 12345 }],
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
  });

  it('ma le tracce sconosciute vengono TENUTE quando il filtro si applica', () => {
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

describe('★ filterPlayerResponse — la guardia SABR (RESEARCH.md R1)', () => {
  /**
   * Osservato il 2026-07-25: con `serverAbrStreamingUrl` presente le tracce non
   * hanno URL, la riproduzione passa dal server, e filtrarle fa rispondere 403 a
   * `videoplayback` con "Your browser can't play this video".
   */
  it('rinuncia quando streamingData contiene serverAbrStreamingUrl', () => {
    const input = fixture('server-abr');
    const result = filterPlayerResponse(input);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('server-abr');
    expect(result.response).toBe(input);
    expect(result.videoId).toBe('FIXTURE_SABR');
  });

  it('la guardia scatta anche se le tracce sarebbero filtrabili', () => {
    // Il punto: la filtrabilità apparente non conta. Se c'è SABR, si rinuncia.
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

  it('la guardia precede quella sul DRM: SABR è la condizione più generale', () => {
    const result = filterPlayerResponse({
      streamingData: {
        serverAbrStreamingUrl: 'https://example.invalid/abr',
        drmParams: 'x',
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }],
      },
    });
    expect(result.reason).toBe('server-abr');
  });

  it('ma NON scatta sui live, che hanno una loro ragione di rinuncia', () => {
    const result = filterPlayerResponse({
      videoDetails: { isLive: true },
      streamingData: {
        serverAbrStreamingUrl: 'https://example.invalid/abr',
        adaptiveFormats: [{ mimeType: 'audio/mp4' }],
      },
    });
    expect(result.reason).toBe('live-stream');
  });

  it('senza SABR il filtro lavora come prima', () => {
    const result = filterPlayerResponse(fixture('normal-video'));
    expect(result.applied).toBe(true);
  });
});

describe('filterPlayerResponse — casi che non vanno toccati', () => {
  it('salta i live rilevati da videoDetails.isLive e dal manifest HLS', () => {
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
  ])('rileva il live anche da %s', (_name, input) => {
    expect(filterPlayerResponse(input).reason).toBe('live-stream');
  });

  it('salta i contenuti con DRM', () => {
    const input = fixture('drm-protected');
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('drm-protected');
    expect(result.response).toBe(input);
  });

  it('rileva il DRM anche dal solo drmFamilies su una traccia', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4', drmFamilies: ['WIDEVINE'] }],
        formats: [{ mimeType: 'video/mp4' }],
      },
    });
    expect(result.reason).toBe('drm-protected');
  });

  it('rileva il DRM da drmFamilies presente solo nei progressivi', () => {
    const result = filterPlayerResponse({
      streamingData: { formats: [{ mimeType: 'video/mp4', drmFamilies: [] }] },
    });
    expect(result.reason).toBe('drm-protected');
  });

  it('non fa nulla se non ci sono tracce video da rimuovere', () => {
    const input = fixture('already-audio-only');
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-video-formats');
    expect(result.response).toBe(input);
  });

  it('non fa nulla su una risposta senza streamingData', () => {
    const result = filterPlayerResponse(fixture('no-streaming-data'));
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-streaming-data');
    expect(result.videoId).toBeUndefined();
  });
});

describe('filterPlayerResponse — array parzialmente presenti', () => {
  it('funziona con soli adaptiveFormats, senza formats', () => {
    const result = filterPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }],
      },
    });
    expect(result.applied).toBe(true);
    const streamingData = (result.response as { streamingData: Record<string, unknown> })
      .streamingData;
    // Il campo assente resta assente: non ne inventiamo uno vuoto.
    expect('formats' in streamingData).toBe(false);
    expect(result.stats.progressiveFormatsRemoved).toBe(0);
  });

  it('con soli formats progressivi la guardia audio scatta', () => {
    // Nessun `adaptiveFormats` → nessuna traccia audio da tenere → si annulla.
    const input = { streamingData: { formats: [{ mimeType: 'video/mp4' }] } };
    const result = filterPlayerResponse(input);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no-audio-formats');
    expect(result.response).toBe(input);
  });
});

describe('filterPlayerResponse — stima dei byte', () => {
  it.each([
    ['stringa numerica', '1024', 1024],
    ['numero', 2048, 2048],
    ['stringa non numerica', 'molti', 0],
    ['stringa vuota', '', 0],
    ['zero', '0', 0],
    ['negativo', '-5', 0],
    ['numero negativo', -5, 0],
    ['non finito', Number.POSITIVE_INFINITY, 0],
    ['assente', undefined, 0],
    ['oggetto', { bytes: 10 }, 0],
  ])('interpreta contentLength %s', (_name, contentLength, expected) => {
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
    ['videoDetails assente', { streamingData: {} }, undefined],
    ['videoDetails non oggetto', { videoDetails: 'x', streamingData: {} }, undefined],
    ['videoId non stringa', { videoDetails: { videoId: 42 }, streamingData: {} }, undefined],
    ['videoId valido', { videoDetails: { videoId: 'abc' }, streamingData: {} }, 'abc'],
  ])('legge il videoId: %s', (_name, input, expected) => {
    expect(filterPlayerResponse(input).videoId).toBe(expected);
  });
});
