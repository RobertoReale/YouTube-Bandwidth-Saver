/**
 * @vitest-environment happy-dom
 *
 * PLAN.md §10 level 2 — hook integration.
 *
 * The most important requirement here isn't "the filter works", it's "everything that
 * is not a player response passes untouched". A `fetch` wrapper breaking
 * `fetch` breaks all of YouTube.
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

/** Context that removes video tracks, like real MAIN world. */
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

/** Transparent context: modifies nothing. */
const passthrough: HookContext = { transform: (input) => input };

/**
 * `window` as seen by page. Interface with optional fields
 * instead of `Record<string, unknown>`: with `noUncheckedIndexedAccess` index access
 * would always return `T | undefined`.
 */
interface PageWindow {
  ytInitialPlayerResponse?: unknown;
  __ytAudioOnlyHooksInstalled?: boolean;
}

const page = (): PageWindow => window as unknown as PageWindow;

/** Reads global with shape test expects. */
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

  it('filters value assigned to inline script', () => {
    const uninstall = installPropertyHook(stripVideo());

    page().ytInitialPlayerResponse = structuredClone(playerJson);

    expect(storedFormats()).toHaveLength(1);
    expect(storedFormats()[0]?.mimeType).toBe('audio/mp4');
    uninstall();
  });

  it('property remains configurable, not to block other extensions', () => {
    const uninstall = installPropertyHook(passthrough);
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
    expect(descriptor?.configurable).toBe(true);
    uninstall();
  });

  it('uninstall preserves value already delivered to page', () => {
    const uninstall = installPropertyHook(passthrough);
    page().ytInitialPlayerResponse = { marker: 1 };
    uninstall();

    expect(page().ytInitialPlayerResponse).toEqual({ marker: 1 });
    expect(Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse')?.get).toBeUndefined();
  });

  it('uninstall restores a pre-existing descriptor', () => {
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
      headers: { 'x-marker': 'preserved', 'content-type': 'application/json' },
    });
    original = vi.fn(() => Promise.resolve(canned));
    window.fetch = original as unknown as typeof window.fetch;
  });

  it('★ non-player response requests return IDENTICAL', async () => {
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(OTHER_URL);

    // Same instance: no copy, no body consumed, no header lost.
    expect(response).toBe(canned);
    expect(await response.text()).toBe(JSON.stringify(playerJson));
    uninstall();
  });

  it('does not even call transform for non-player requests', async () => {
    const ctx = stripVideo();
    const uninstall = installFetchHook(ctx);
    await window.fetch(OTHER_URL);
    expect(ctx.calls).toHaveLength(0);
    uninstall();
  });

  it('forwards all arguments to original fetch', async () => {
    const uninstall = installFetchHook(passthrough);
    const init = { method: 'POST', body: 'x' };
    await window.fetch(OTHER_URL, init);
    expect(original).toHaveBeenCalledWith(OTHER_URL, init);
    uninstall();
  });

  it('filters requests to /youtubei/v1/player', async () => {
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(PLAYER_URL);
    const body = (await response.json()) as typeof playerJson;

    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('preserves status, statusText and headers on rewritten response', async () => {
    const uninstall = installFetchHook(stripVideo());
    const response = await window.fetch(PLAYER_URL);

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.headers.get('x-marker')).toBe('preserved');
    uninstall();
  });

  it('also recognizes a Request object as input', async () => {
    const uninstall = installFetchHook(stripVideo());
    const response = await window.fetch(new Request(PLAYER_URL));
    const body = (await response.json()) as typeof playerJson;
    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('returns original response if transform changes nothing', async () => {
    const uninstall = installFetchHook(passthrough);
    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it('fail-open on non-JSON body to player endpoint', async () => {
    canned = new Response('adaptiveFormats but not JSON', { status: 200 });
    original.mockResolvedValue(canned);
    const uninstall = installFetchHook(stripVideo());

    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it('fail-open if transform throws', async () => {
    const uninstall = installFetchHook({
      transform() {
        throw new Error('boom');
      },
    });
    const response = await window.fetch(PLAYER_URL);
    expect(response).toBe(canned);
    uninstall();
  });

  it('uninstall restores original fetch', () => {
    const uninstall = installFetchHook(passthrough);
    expect(window.fetch).not.toBe(original);
    uninstall();
    expect(window.fetch).toBe(original);
  });

  it("uninstall does not overwrite someone else's hook", () => {
    const uninstall = installFetchHook(passthrough);
    const somebodyElse = vi.fn() as unknown as typeof window.fetch;
    window.fetch = somebodyElse;
    uninstall();
    expect(window.fetch).toBe(somebodyElse);
  });
});

describe('installXhrHook', () => {
  const realXhr = globalThis.XMLHttpRequest;

  /** Fake XHR: no network, but with same descriptors as real. */
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

  it('filters responseText for requests to player endpoint', () => {
    const uninstall = installXhrHook(stripVideo());

    const xhr = new XMLHttpRequest();
    xhr.open('GET', PLAYER_URL);
    xhr.send();

    const body = JSON.parse(xhr.responseText) as typeof playerJson;
    expect(body.streamingData.adaptiveFormats).toHaveLength(1);
    uninstall();
  });

  it('★ does not touch responseText of other requests', () => {
    const uninstall = installXhrHook(stripVideo());

    const xhr = new XMLHttpRequest();
    xhr.open('GET', OTHER_URL);
    xhr.send();

    expect(xhr.responseText).toBe(JSON.stringify(playerJson));
    uninstall();
  });

  it('also filters `response` when it is an already parsed object', () => {
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

  it('forwards arguments to original open and send', () => {
    const uninstall = installXhrHook(passthrough);
    const xhr = new XMLHttpRequest() as unknown as FakeXhr;
    (xhr as unknown as XMLHttpRequest).open('POST', OTHER_URL, true);
    (xhr as unknown as XMLHttpRequest).send();

    expect(xhr.opened).toEqual(['POST', OTHER_URL, true]);
    expect(xhr.sent).toBe(true);
    uninstall();
  });

  it('uninstall restores open and send', () => {
    const before = { open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send };
    const uninstall = installXhrHook(passthrough);
    expect(XMLHttpRequest.prototype.open).not.toBe(before.open);
    uninstall();
    expect(XMLHttpRequest.prototype.open).toBe(before.open);
    expect(XMLHttpRequest.prototype.send).toBe(before.send);
  });

  it('gives up without throwing if expected descriptors do not exist', () => {
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

  it('is idempotent: second installation does nothing', () => {
    const first = installHooks(passthrough);
    const patched = window.fetch;

    const second = installHooks(stripVideo());
    expect(window.fetch).toBe(patched); // no double wrapping

    second(); // uninstall of second is no-op
    expect(window.fetch).toBe(patched);

    first();
  });

  it('uninstall releases sentinel', () => {
    const uninstall = installHooks(passthrough);
    expect(page().__ytAudioOnlyHooksInstalled).toBe(true);
    uninstall();
    expect(page().__ytAudioOnlyHooksInstalled).toBeUndefined();
  });
});
