/**
 * PLAN.md §6 — hook installation in MAIN world.
 *
 * Requirements implemented:
 *  - Synchronous: no `await` prior to installation, or inline player response
 *    has already been read.
 *  - Idempotent: sentinel on `window` prevents duplicate installation.
 *  - Transparent: everything that is not a player response passes untouched.
 *  - Reversible: each hook returns its uninstall function.
 *  - `configurable: true`: we do not prevent other extensions from installing
 *    their hooks over ours.
 */

import { PLAYER_ENDPOINTS, PLAYER_RESPONSE_GLOBALS } from '../selectors';
import type { HookSource } from '../types';
import { looksLikePlayerResponseText } from './response-schema';

/** Transforms a player response. MUST be synchronous and never throw. */
export type Transform = (input: unknown, source: HookSource) => unknown;

export interface HookContext {
  readonly transform: Transform;
}

const SENTINEL = '__ytAudioOnlyHooksInstalled';

function isPlayerUrl(url: string): boolean {
  for (const endpoint of PLAYER_ENDPOINTS) {
    if (url.includes(endpoint)) return true;
  }
  return false;
}

/** Applies transform to JSON text. Fail-open on any issue. */
function transformText(text: string, ctx: HookContext, source: HookSource): string {
  if (!looksLikePlayerResponseText(text)) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text; // Truncated JSON or non-JSON: returned untouched.
  }
  const out = ctx.transform(parsed, source);
  if (out === parsed) return text; // not applied: avoid useless re-stringify
  try {
    return JSON.stringify(out);
  } catch {
    return text;
  }
}

/**
 * Hook 1 — `window.ytInitialPlayerResponse`.
 *
 * Works because `var ytInitialPlayerResponse = {...}` declaration in
 * YouTube inline script doesn't redefine an existing accessor property that is
 * `configurable`: assignment passes through our setter.
 */
export function installPropertyHook(ctx: HookContext): () => void {
  const restores: (() => void)[] = [];

  for (const name of PLAYER_RESPONSE_GLOBALS) {
    const target = window as unknown as Record<string, unknown>;
    const previousDescriptor = Object.getOwnPropertyDescriptor(target, name);
    let stored: unknown = previousDescriptor?.value;

    try {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: unknown) => {
          stored = ctx.transform(value, 'property');
        },
      });
    } catch {
      continue; // property non-redefinable: give up on this hook without throwing
    }

    restores.push(() => {
      const current = stored;
      try {
        if (previousDescriptor) {
          Object.defineProperty(target, name, previousDescriptor);
        } else {
          delete target[name];
          // Value already delivered to page must be preserved, otherwise
          // disabling would erase data that player is still using.
          target[name] = current;
        }
      } catch {
        /* fail-open */
      }
    });
  }

  return () => {
    for (const restore of restores) restore();
  };
}

/** Hook 2 — `window.fetch` (SPA navigations). */
export function installFetchHook(ctx: HookContext): () => void {
  const original = window.fetch;

  const wrapped: typeof window.fetch = function (this: unknown, ...args) {
    const promise = Reflect.apply(original, this, args);
    let url: string;
    try {
      const [input] = args;
      url = input instanceof Request ? input.url : String(input);
    } catch {
      return promise;
    }
    // ★ Any request that is not a player response leaves here untouched:
    //   same Promise, same Response, same streaming body.
    if (!isPlayerUrl(url)) return promise;

    return promise.then(async (response) => {
      try {
        const text = await response.clone().text();
        const filtered = transformText(text, ctx, 'fetch');
        if (filtered === text) return response;
        return new Response(filtered, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response; // fail-open: original response passes untouched
      }
    });
  };

  window.fetch = wrapped;
  return () => {
    // Only if no one else replaced `fetch` after us: overwriting
    // someone else's hook would be worse than leaving ours installed.
    if (window.fetch === wrapped) window.fetch = original;
  };
}

interface TrackedXhr extends XMLHttpRequest {
  __ytaoUrl?: string;
}

/**
 * Searches for a descriptor up prototype chain.
 * On native `XMLHttpRequest` getters are prototype properties, but
 * if another extension subclassed `XMLHttpRequest` they are on an
 * ancestor: searching only own properties would cause hook to give up.
 */
function findDescriptor(start: object, key: string): PropertyDescriptor | undefined {
  let current: object | null = start;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

/**
 * Hook 3 — `XMLHttpRequest` (legacy paths).
 *
 * Getters installed on instance in `send()` and filter at reading time:
 * so there's no dependency on order YouTube registers
 * its listeners, which is where this hook would fail.
 */
export function installXhrHook(ctx: HookContext): () => void {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const textDescriptor = findDescriptor(proto, 'responseText');
  const responseDescriptor = findDescriptor(proto, 'response');

  if (!textDescriptor?.get || !responseDescriptor?.get) return () => {};
  const readText = textDescriptor.get;
  const readResponse = responseDescriptor.get;

  const wrappedOpen = function (this: TrackedXhr, ...args: unknown[]): void {
    try {
      this.__ytaoUrl = String(args[1] ?? '');
    } catch {
      this.__ytaoUrl = '';
    }
    Reflect.apply(originalOpen, this, args);
  } as typeof proto.open;

  const wrappedSend = function (this: TrackedXhr, ...args: unknown[]): void {
    const url = this.__ytaoUrl;
    if (typeof url === 'string' && isPlayerUrl(url)) {
      try {
        Object.defineProperty(this, 'responseText', {
          configurable: true,
          get: (): string => {
            const raw = Reflect.apply(readText, this, []) as string;
            return typeof raw === 'string' ? transformText(raw, ctx, 'xhr') : raw;
          },
        });
        Object.defineProperty(this, 'response', {
          configurable: true,
          get: (): unknown => {
            const raw = Reflect.apply(readResponse, this, []) as unknown;
            if (typeof raw === 'string') return transformText(raw, ctx, 'xhr');
            // `responseType: 'json'` delivers already parsed object.
            if (raw !== null && typeof raw === 'object') return ctx.transform(raw, 'xhr');
            return raw;
          },
        });
      } catch {
        /* fail-open: request proceeds unfiltered */
      }
    }
    Reflect.apply(originalSend, this, args);
  } as typeof proto.send;

  proto.open = wrappedOpen;
  proto.send = wrappedSend;

  return () => {
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
  };
}

/**
 * Installs all three hooks. Idempotent: second call does nothing
 * and returns a no-op uninstall.
 */
export function installHooks(ctx: HookContext): () => void {
  const target = window as unknown as Record<string, unknown>;
  if (target[SENTINEL] === true) return () => {};
  target[SENTINEL] = true;

  const uninstalls = [installPropertyHook(ctx), installFetchHook(ctx), installXhrHook(ctx)];

  return () => {
    for (const uninstall of uninstalls) uninstall();
    delete target[SENTINEL];
  };
}
