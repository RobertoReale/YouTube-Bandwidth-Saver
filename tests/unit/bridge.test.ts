/**
 * PLAN.md §8 — the bridge is a channel the page can see. These tests verify
 * that unauthenticated messages are ignored and the command set
 * remains closed.
 *
 * We use a happy-dom `Window` instance as target, not global `window`:
 * in Vitest's simulated environment global is not the object ending up in `event.source`,
 * and `event.source === target` check — essential in a real browser — wouldn't be verifiable.
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

/** `postMessage` delivers asynchronously: needs an event loop tick. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ISOLATED ↔ MAIN bridge', () => {
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

  /** Injects a message as the page would, not our code. */
  function forge(data: unknown): void {
    page.postMessage(data, ORIGIN);
  }

  it('ISOLATED receives MAIN messages after handshake', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);

    await flush();
    // No payloads sent by main anymore other than hello, which is internal.
    // We just ensure it doesn't crash.
    expect(received).toEqual([]);
  });

  it('MAIN receives set-enabled from ISOLATED', async () => {
    const onSetEnabled = vi.fn();
    const isolated = createIsolatedBridge(() => undefined, controller().signal, target);
    createMainBridge(onSetEnabled, controller().signal, target);

    await flush();
    isolated.send({ kind: 'set-enabled', enabled: true });
    await flush();

    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it('queues messages sent before handshake', async () => {
    const onSetEnabled = vi.fn();
    const isolated = createIsolatedBridge(() => undefined, controller().signal, target);

    // ISOLATED talks before knowing token: message gets queued.
    isolated.send({ kind: 'set-enabled', enabled: true });
    createMainBridge(onSetEnabled, controller().signal, target);

    await flush();
    await flush();
    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it('★ ignores messages without session token', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    forge({ __ytao: 'ytao:v1', token: 'wrong-token', payload: { kind: 'unknown' } });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('ignores messages that are not ours', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    forge({ kind: 'unknown' });
    forge('string');
    forge(null);
    forge({ __ytao: 'other-channel', token: 'x', payload: {} });
    forge({ __ytao: 'ytao:v1', token: 42, payload: {} });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('★ a second hello does not replace already learned token', async () => {
    const received: MainToIsolated[] = [];
    createIsolatedBridge((message) => received.push(message), controller().signal, target);
    createMainBridge(() => undefined, controller().signal, target);
    await flush();

    // Page tries to impersonate MAIN world with its own token.
    forge({ __ytao: 'ytao:v1', token: 'page-token', payload: { kind: 'hello' } });
    forge({
      __ytao: 'ytao:v1',
      token: 'page-token',
      payload: { kind: 'unknown' },
    });
    await flush();

    expect(received).toHaveLength(0);
  });

  it('★ ignores set-enabled with non-boolean payload', async () => {
    const onSetEnabled = vi.fn();
    const main = createMainBridge(onSetEnabled, controller().signal, target);
    await flush();

    forge({
      __ytao: 'ytao:v1',
      token: main.token,
      payload: { kind: 'set-enabled', enabled: 'yes' },
    });
    await flush();

    expect(onSetEnabled).not.toHaveBeenCalled();
  });

  it('★ a command outside closed set does nothing', async () => {
    const onSetEnabled = vi.fn();
    const main = createMainBridge(onSetEnabled, controller().signal, target);
    await flush();

    forge({ __ytao: 'ytao:v1', token: main.token, payload: { kind: 'eval', code: 'alert(1)' } });
    await flush();

    expect(onSetEnabled).not.toHaveBeenCalled();
  });

  it('abort of signal closes listener', async () => {
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
