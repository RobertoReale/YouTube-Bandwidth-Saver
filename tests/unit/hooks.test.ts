/**
 * @vitest-environment happy-dom
 *
 * PLAN.md §10 livello 2 — integrazione degli hook.
 *
 * Il requisito più importante qui non è "il filtro funziona", è "tutto ciò che
 * non è un player response passa intatto". Un wrapper di `fetch` che rompe
 * `fetch` rompe YouTube intero.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookContext } from '../../lib/player/hooks';
import {
  installFetchHook,
  installHooks,
  installPropertyHook,
  installXhrHook,
} from '../../lib/player/hooks';

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?key=abc&prettyPrint=false';
const OTHER_URL = 'https://www.youtube.com/results?search_query=test';

const playerJson = {
  streamingData: {
    adaptiveFormats: [{ mimeType: 'video/mp4', contentLength: '100' }, { mimeType: 'audio/mp4' }],
  },
};

/** Contesto che rimuove le tracce video, come il vero MAIN world. */
function stripVideo(): HookContext & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    transform(input) {
      calls.push(input);
      if (typeof input !== 'object' || input === null) return input;
      const record = input as Record<string, unknown>;
      const streamingData = record.streamingData as Record<string, unknown> | undefined;
      if (!streamingData) return input;
      const formats = streamingData.adaptiveFormats as { mimeType?: string }[] | undefined;
      if (!formats) return input;
      return {
        ...record,
        streamingData: {
          ...streamingData,
          adaptiveFormats: formats.filter((f) => !f.mimeType?.startsWith('video/')),
        },
      };
    },
  };
}

/** Contesto trasparente: non modifica nulla. */
const passthrough: HookContext = { transform: (input) => input };

/**
 * `window` visto come lo vede la pagina. Un'interfaccia con campi opzionali
 * invece di `Record<string, unknown>`: con `noUncheckedIndexedAccess` l'accesso
 * per indice restituirebbe sempre `T | undefined`.
 */
interface PageWindow {
  ytInitialPlayerResponse?: unknown;
  __ytAudioOnlyHooksInstalled?: boolean;
}

const page = (): PageWindow => window as unknown as PageWindow;

/** Legge la globale con la forma che il test si aspetta. */
function storedFormats(): { mimeType?: string }[] {
  const stored = page().ytInitialPlayerResponse as
    | { streamingData?: { adaptiveFormats?: { mimeType?: string }[] } }
    | undefined;
  return stored?.streamingData?.adaptiveFormats ?? [];
}

describe('installPropertyHook', () => {
  afterEach(() => {
    delete page().ytInitialPlayerResponse;
  });

  it('filtra il valore assegnato allo script inline', () => {
    const uninstall = installPropertyHook(stripVideo());

    page().ytInitialPlayerResponse = structuredClone(playerJson);

    expect(storedFormats()).toHaveLength(1);
    expect(storedFormats()[0]?.mimeType).toBe('audio/mp4');
    uninstall();
  });

  it('la property resta configurabile, per non bloccare altre estensioni', () => {
    const uninstall = installPropertyHook(passthrough);
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
    expect(descriptor?.configurable).toBe(true);
    uninstall();
  });

  it('la disinstallazione preserva il valore già consegnato alla pagina', () => {
    const uninstall = installPropertyHook(passthrough);
    page().ytInitialPlayerResponse = { marker: 1 };
    uninstall();

    expect(page().ytInitialPlayerResponse).toEqual({ marker: 1 });
    expect(Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')?.get).toBeUndefined();
  });

  it('la disinstallazione ripristina un descrittore preesistente', () => {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      writable: true,
      value: { original: true },
    });
    const uninstall = installPropertyHook(passthrough);
    uninstall();

    expect(page().ytInitialPlayerResponse).toEqual({ original: true });
  });
});

describe('installFetchHook', () => {
  let original: ReturnType<typeof vi.fn>;
  let canned: Response;

  beforeEach(() => {
    canned = new Response(JSON.stringify(playerJson), {
      status: 200,
      statusText: 'OK',
      headers: { 'x-marker': 'preservato', 'content-type': 'application/json' },
    });
    original = vi.fn(() => Promise.resolve(canned));
    window.fetch = original as unknown as typeof window.fetch;
  });

  it('★ le richieste che non sono player response tornano IDENTICHE', async () => {
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(OTHER_URL);

    // Stessa istanza: nessuna copia, nessun body consumato, nessun header perso.
    expect(response).toBe(canned);
    expect(await response.text()).toBe(JSON.stringify(playerJson));
    uninstall();
  });

  it('non chiama nemmeno il transform per le richieste non-player', async () => {
    const ctx = stripVideo();
    const uninstall = installFetchHook(ctx);
    await window.fetch(OTHER_URL);
    expect(ctx.calls).toHaveLength(0);
    uninstall();
  });

  it('inoltra tutti gli argomenti alla fetch originale', async () => {
    const uninstall = installFetchHook(passthrough);
    const init = { method: 'POST', body: 'x' };
    await window.fetch(OTHER_URL, init);
    expect(original).toHaveBeenCalledWith(OTHER_URL, init);
    uninstall();
  });

  it('filtra le richieste verso /youtubei/v1/player', async () => {
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(PLAYER_URL);
    const body = (await response.json()) as typeof playerJson;

    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('preserva status, statusText e header sulla response riscritta', async () => {
    const uninstall = installFetchHook(stripVideo());
    const response = await window.fetch(PLAYER_URL);

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.headers.get('x-marker')).toBe('preservato');
    uninstall();
  });

  it('riconosce anche un oggetto Request come input', async () => {
    const uninstall = installFetchHook(stripVideo());
    const response = await window.fetch(new Request(PLAYER_URL));
    const body = (await response.json()) as typeof playerJson;
    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('restituisce la response originale se il transform non cambia nulla', async () => {
    const uninstall = installFetchHook(passthrough);
    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it("fail-open su body non-JSON verso l'endpoint player", async () => {
    canned = new Response('adaptiveFormats ma non JSON', { status: 200 });
    original.mockResolvedValue(canned);
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it('fail-open se il transform lancia', async () => {
    const uninstall = installFetchHook({
      transform() {
        throw new Error('boom');
      },
    });
    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it('la disinstallazione ripristina la fetch originale', () => {
    const uninstall = installFetchHook(passthrough);
    expect(window.fetch).not.toBe(original);
    uninstall();
    expect(window.fetch).toBe(original);
  });

  it("la disinstallazione non sovrascrive l'hook di qualcun altro", () => {
    const uninstall = installFetchHook(passthrough);
    const somebodyElse = vi.fn() as unknown as typeof window.fetch;
    window.fetch = somebodyElse;
    uninstall();
    expect(window.fetch).toBe(somebodyElse);
  });
});

describe('installXhrHook', () => {
  const realXhr = globalThis.XMLHttpRequest;

  /** XHR finto: nessuna rete, ma con gli stessi descrittori del vero. */
  class FakeXhr {
    public opened: unknown[] = [];
    public sent = false;
    protected raw = JSON.stringify(playerJson);

    open(...args: unknown[]): void {
      this.opened = args;
    }
    send(): void {
      this.sent = true;
    }
    get responseText(): string {
      return this.raw;
    }
    get response(): unknown {
      return this.raw;
    }
  }

  beforeEach(() => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = realXhr;
  });

  it("filtra responseText per le richieste verso l'endpoint player", () => {
    const uninstall = installXhrHook(stripVideo());

    const xhr = new XMLHttpRequest();
    xhr.open('GET', PLAYER_URL);
    xhr.send();

    const body = JSON.parse(xhr.responseText) as typeof playerJson;
    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('★ non tocca responseText delle altre richieste', () => {
    const uninstall = installXhrHook(stripVideo());

    const xhr = new XMLHttpRequest();
    xhr.open('GET', OTHER_URL);
    xhr.send();

    expect(xhr.responseText).toBe(JSON.stringify(playerJson));
    uninstall();
  });

  it('filtra anche `response` quando è un oggetto già parsato', () => {
    class JsonXhr extends FakeXhr {
      override get response(): unknown {
        return structuredClone(playerJson);
      }
    }
    globalThis.XMLHttpRequest = JsonXhr as unknown as typeof XMLHttpRequest;
    const uninstall = installXhrHook(stripVideo());

    const xhr = new XMLHttpRequest();
    xhr.open('GET', PLAYER_URL);
    xhr.send();

    const body = xhr.response as typeof playerJson;
    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('inoltra gli argomenti a open e send originali', () => {
    const uninstall = installXhrHook(passthrough);
    const xhr = new XMLHttpRequest() as unknown as FakeXhr;
    (xhr as unknown as XMLHttpRequest).open('POST', OTHER_URL, true);
    (xhr as unknown as XMLHttpRequest).send();

    expect(xhr.opened).toEqual(['POST', OTHER_URL, true]);
    expect(xhr.sent).toBe(true);
    uninstall();
  });

  it('la disinstallazione ripristina open e send', () => {
    const before = { open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send };
    const uninstall = installXhrHook(passthrough);
    expect(XMLHttpRequest.prototype.open).not.toBe(before.open);
    uninstall();
    expect(XMLHttpRequest.prototype.open).toBe(before.open);
    expect(XMLHttpRequest.prototype.send).toBe(before.send);
  });

  it('rinuncia senza lanciare se i descrittori attesi non esistono', () => {
    class Bare {
      open(): void {}
      send(): void {}
    }
    globalThis.XMLHttpRequest = Bare as unknown as typeof XMLHttpRequest;
    const uninstall = installXhrHook(passthrough);
    expect(() => uninstall()).not.toThrow();
  });
});

describe('installHooks', () => {
  afterEach(() => {
    delete page().__ytAudioOnlyHooksInstalled;
    delete page().ytInitialPlayerResponse;
  });

  it('è idempotente: la seconda installazione non fa nulla', () => {
    const first = installHooks(passthrough);
    const patched = window.fetch;

    const second = installHooks(stripVideo());
    expect(window.fetch).toBe(patched); // nessun doppio wrapping

    second(); // la disinstallazione della seconda è no-op
    expect(window.fetch).toBe(patched);

    first();
  });

  it('la disinstallazione libera la sentinella', () => {
    const uninstall = installHooks(passthrough);
    expect(page().__ytAudioOnlyHooksInstalled).toBe(true);
    uninstall();
    expect(page().__ytAudioOnlyHooksInstalled).toBeUndefined();
  });
});
