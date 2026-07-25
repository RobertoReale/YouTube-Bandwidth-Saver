/**
 * PLAN.md §6 — installazione degli hook nel MAIN world.
 *
 * Requisiti implementati:
 *  - Sincroni: nessun `await` prima dell'installazione, o il player response
 *    inline è già stato letto.
 *  - Idempotenti: una sentinella su `window` evita la doppia installazione.
 *  - Trasparenti: tutto ciò che non è un player response passa intatto.
 *  - Reversibili: ogni hook restituisce la sua funzione di disinstallazione.
 *  - `configurable: true`: non impediamo ad altre estensioni di installare
 *    i propri hook sopra i nostri.
 */

import { PLAYER_ENDPOINTS, PLAYER_RESPONSE_GLOBALS } from '../selectors';
import type { HookSource } from '../types';
import { looksLikePlayerResponseText } from './response-schema';

/** Trasforma un player response. DEVE essere sincrona e non lanciare. */
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

/** Applica il transform a un testo JSON. Fail-open su qualunque problema. */
function transformText(text: string, ctx: HookContext, source: HookSource): string {
  if (!looksLikePlayerResponseText(text)) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text; // JSON troncato o non-JSON: si restituisce intatto.
  }
  const out = ctx.transform(parsed, source);
  if (out === parsed) return text; // non applicato: evita un re-stringify inutile
  try {
    return JSON.stringify(out);
  } catch {
    return text;
  }
}

/**
 * Hook 1 — `window.ytInitialPlayerResponse`.
 *
 * Funziona perché la dichiarazione `var ytInitialPlayerResponse = {...}` dello
 * script inline di YouTube non ridefinisce una property accessor già esistente e
 * `configurable`: l'assegnazione passa dal nostro setter.
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
      continue; // property non ridefinibile: si rinuncia a questo hook, non si lancia
    }

    restores.push(() => {
      const current = stored;
      try {
        if (previousDescriptor) {
          Object.defineProperty(target, name, previousDescriptor);
        } else {
          delete target[name];
          // Il valore già consegnato alla pagina va preservato, altrimenti la
          // disattivazione cancellerebbe un dato che il player usa ancora.
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

/** Hook 2 — `window.fetch` (navigazioni SPA). */
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
    // ★ Ogni richiesta che non è un player response esce da qui senza essere
    //   toccata: stessa Promise, stessa Response, stesso body streaming.
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
        return response; // fail-open: la response originale passa intatta
      }
    });
  };

  window.fetch = wrapped;
  return () => {
    // Solo se nessun altro ha rimpiazzato `fetch` dopo di noi: sovrascrivere
    // l'hook di qualcun altro sarebbe peggio che lasciare il nostro installato.
    if (window.fetch === wrapped) window.fetch = original;
  };
}

interface TrackedXhr extends XMLHttpRequest {
  __ytaoUrl?: string;
}

/**
 * Cerca un descrittore risalendo la catena dei prototipi.
 * Su `XMLHttpRequest` nativo i getter sono proprietà proprie del prototipo, ma
 * se un'altra estensione ha sottoclassato `XMLHttpRequest` si trovano su un
 * antenato: cercare solo fra le proprietà proprie farebbe rinunciare l'hook.
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
 * Hook 3 — `XMLHttpRequest` (percorsi legacy).
 *
 * I getter sono installati sull'istanza in `send()` e filtrano al momento della
 * lettura: così non c'è nessuna dipendenza dall'ordine con cui YouTube registra
 * i propri listener, che è il punto dove questo hook fallirebbe.
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
            // `responseType: 'json'` consegna un oggetto già parsato.
            if (raw !== null && typeof raw === 'object') return ctx.transform(raw, 'xhr');
            return raw;
          },
        });
      } catch {
        /* fail-open: la richiesta procede non filtrata */
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
 * Installa tutti e tre gli hook. Idempotente: una seconda chiamata non fa nulla
 * e restituisce una disinstallazione no-op.
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
