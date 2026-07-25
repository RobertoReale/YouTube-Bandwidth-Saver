/**
 * SPIKE fase 0 — PLAN.md §14. Codice usa-e-getta, non è la base della fase 1.
 *
 * Unico scopo: rispondere a "il player YouTube parte senza tracce video?".
 * Vincoli rispettati da subito: nessun eval/new Function, nessuna richiesta di
 * rete, fail-open su qualunque input non riconoscibile.
 */
(() => {
  'use strict';

  if (window.__ytAudioOnlySpike) return; // idempotenza: all_frames + doppia iniezione
  window.__ytAudioOnlySpike = { property: 0, fetch: 0, xhr: 0, skipped: [] };
  const S = window.__ytAudioOnlySpike;

  const log = (...a) => console.log('%c[spike]', 'color:#0a0;font-weight:bold', ...a);
  const PLAYER_ENDPOINT = '/youtubei/v1/player';

  const isVideoTrack = (f) =>
    typeof f?.mimeType === 'string'
      ? f.mimeType.startsWith('video/')
      : typeof f?.width === 'number' || typeof f?.height === 'number';

  /** Filtra un player response. Non muta l'input. Fail-open: in dubbio, torna `input`. */
  function filter(input, tag) {
    try {
      const sd = input?.streamingData;
      if (!sd || typeof sd !== 'object') return skip(input, tag, 'no-streaming-data');
      if (input?.videoDetails?.isLive || sd.hlsManifestUrl || sd.dashManifestUrl) {
        return skip(input, tag, 'live-stream');
      }

      const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
      const audio = adaptive.filter((f) => !isVideoTrack(f));
      if (audio.length === 0) return skip(input, tag, 'no-audio-formats'); // guardia critica

      const removed = adaptive.length - audio.length;
      const progressive = Array.isArray(sd.formats) ? sd.formats.length : 0;
      const out = { ...input, streamingData: { ...sd, adaptiveFormats: audio, formats: [] } };

      S[tag]++;
      log(`${tag}: -${removed} video, -${progressive} progressive, ${audio.length} audio tenute`, {
        itags: audio.map((f) => f.itag),
        videoId: input?.videoDetails?.videoId,
      });
      return out;
    } catch (e) {
      return skip(input, tag, 'threw:' + e); // fail-open anche sulle eccezioni
    }
  }

  const skip = (input, tag, reason) => (S.skipped.push(tag + ':' + reason), log(`${tag} SALTATO: ${reason}`), input);

  /** Filtra testo JSON; se non è parsabile o non è un player response, torna il testo intatto. */
  function filterText(text, tag) {
    if (typeof text !== 'string' || !text.includes('adaptiveFormats')) return text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text;
    }
    const out = filter(parsed, tag);
    return out === parsed ? text : JSON.stringify(out);
  }

  // ── Hook 1: window.ytInitialPlayerResponse (primo caricamento, script inline) ──
  let stored;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true, // non impedire ad altre estensioni di installare i propri hook
    get: () => stored,
    set: (v) => {
      stored = v && typeof v === 'object' ? filter(v, 'property') : v;
    },
  });

  // ── Hook 2: fetch (navigazioni SPA) ──
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = args[0] instanceof Request ? args[0].url : String(args[0] ?? '');
    const p = origFetch.apply(this, args);
    if (!url.includes(PLAYER_ENDPOINT)) return p; // ogni altra richiesta passa intatta
    return p.then(async (res) => {
      try {
        const text = await res.clone().text();
        const filtered = filterText(text, 'fetch');
        if (filtered === text) return res;
        return new Response(filtered, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch {
        return res;
      }
    });
  };

  // ── Hook 3: XMLHttpRequest (percorsi legacy) ──
  const descText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const descResp = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__spikeUrl = String(url ?? '');
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__spikeUrl?.includes(PLAYER_ENDPOINT)) {
      // Getter lazy: nessun problema di ordine con i listener di YouTube.
      Object.defineProperty(this, 'responseText', {
        configurable: true,
        get: () => filterText(descText.get.call(this), 'xhr'),
      });
      Object.defineProperty(this, 'response', {
        configurable: true,
        get: () => {
          const raw = descResp.get.call(this);
          return typeof raw === 'string' ? filterText(raw, 'xhr') : raw && typeof raw === 'object' ? filter(raw, 'xhr') : raw;
        },
      });
    }
    return origSend.apply(this, args);
  };

  log('hook installati (property + fetch + xhr). Stato in window.__ytAudioOnlySpike');
})();
