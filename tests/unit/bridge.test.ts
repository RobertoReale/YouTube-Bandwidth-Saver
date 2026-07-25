/**
 * PLAN.md §8 — il ponte è un canale che la pagina vede. Questi test verificano
 * che i messaggi non autenticati vengano ignorati e che l'insieme dei comandi
 * resti chiuso.
 *
 * Usiamo un'istanza `Window` di happy-dom come bersaglio, non il `window`
 * globale: nell'ambiente simulato di Vitest il globale non è l'oggetto che
 * finisce in `event.source`, e il controllo `event.source === target` — che in
 * un browser reale è essenziale — non sarebbe verificabile.
 */

import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BridgeTarget,
  createIsolatedBridge,
  createMainBridge,
  type MainToIsolated,
} from '../../lib/bridge';

const ORIGIN = 'https://www.youtube.com';

/** `postMessage` consegna in modo asincrono: serve un giro di event loop. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ponte ISOLATED ↔ MAIN', () => {
  let page: Window;
  let target: BridgeTarget;
  const controllers: AbortController[] = [];

  beforeEach(() => {
    page = new Window({ url: `${ORIGIN}/watch?v=abc` });
    target = page as unknown as BridgeTarget;
  });

  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.abort();
  });

  function controller(): AbortController {
    const created = new AbortController();
    controllers.push(created);
    return created;
  }

  /** Inietta un messaggio come farebbe la pagina, non il nostro codice. */
  function forge(data: unknown): void {
    page.postMessage(data, ORIGIN);
  }

  it("l'ISOLATED riceve i messaggi del MAIN dopo l'handshake", async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    const main = createMainBridge(() => undefined, controller().signal, target);

    await flush();
    main.send({ kind: 'filter-applied', videoId: 'abc', bytesSaved: 1024 });
    await flush();

    expect(received).toEqual([{ kind: 'filter-applied', videoId: 'abc', bytesSaved: 1024 }]);
  });

  it("il MAIN riceve set-enabled dall'ISOLATED", async () => {
    const onSetEnabled = vi.fn();
    const isolated = createIsolatedBridge(() => undefined, controller().signal, target);
    createMainBridge(onSetEnabled, controller().signal, target);

    await flush();
    isolated.send({ kind: 'set-enabled', enabled: true });
    await flush();

    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it("mette in coda i messaggi inviati prima dell'handshake", async () => {
    const onSetEnabled = vi.fn();
    const isolated = createIsolatedBridge(() => undefined, controller().signal, target);

    // L'ISOLATED parla prima di conoscere il token: il messaggio va in coda.
    isolated.send({ kind: 'set-enabled', enabled: true });
    createMainBridge(onSetEnabled, controller().signal, target);

    await flush();
    await flush();
    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it('★ ignora i messaggi senza il token di sessione', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    forge({ __ytao: 'ytao:v1', token: 'token-sbagliato', payload: { kind: 'filter-applied' } });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('ignora i messaggi che non sono nostri', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    forge({ kind: 'filter-applied' });
    forge('stringa');
    forge(null);
    forge({ __ytao: 'canale-altrui', token: 'x', payload: {} });
    forge({ __ytao: 'ytao:v1', token: 42, payload: {} });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('★ un secondo hello non sostituisce il token già appreso', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    // La pagina prova a farsi passare per il MAIN world con un token proprio.
    forge({ __ytao: 'ytao:v1', token: 'token-pagina', payload: { kind: 'hello' } });
    forge({
      __ytao: 'ytao:v1',
      token: 'token-pagina',
      payload: { kind: 'filter-applied', videoId: 'x', bytesSaved: 1 },
    });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('★ ignora un set-enabled con payload non booleano', async () => {
    const onSetEnabled = vi.fn();
    const main = createMainBridge(onSetEnabled, controller().signal, target);
    await flush();

    forge({
      __ytao: 'ytao:v1',
      token: main.token,
      payload: { kind: 'set-enabled', enabled: 'si' },
    });
    await flush();

    expect(onSetEnabled).not.toHaveBeenCalled();
  });

  it("★ un comando fuori dall'insieme chiuso non fa nulla", async () => {
    const onSetEnabled = vi.fn();
    const main = createMainBridge(onSetEnabled, controller().signal, target);
    await flush();

    forge({ __ytao: 'ytao:v1', token: main.token, payload: { kind: 'eval', code: 'alert(1)' } });
    await flush();

    expect(onSetEnabled).not.toHaveBeenCalled();
  });

  it("l'abort del signal chiude l'ascolto", async () => {
    const onSetEnabled = vi.fn();
    const own = controller();
    const isolated = createIsolatedBridge(() => undefined, controller().signal, target);
    createMainBridge(onSetEnabled, own.signal, target);
    await flush();

    own.abort();
    isolated.send({ kind: 'set-enabled', enabled: true });
    await flush();

    expect(onSetEnabled).not.toHaveBeenCalled();
  });
});
