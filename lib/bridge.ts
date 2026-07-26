/**
 * ISOLATED <-> MAIN bridge.
 *
 * `window.postMessage` is visible to the page and any other script, so:
 *  - every message carries a per-session generated token;
 *  - `event.source === window` and `event.origin` are always verified;
 *  - set of commands is CLOSED, never generic dispatch;
 *  - only configuration flags pass through here, no sensitive data.
 *
 * Threat model honesty: token is not a secret from the page —
 * in MAIN world page can read everything we hold in memory. It serves to
 * exclude collisions with other scripts and random forging. True defense is
 * that most powerful command on this channel turns audio-only on/off, and
 * MAIN world cannot ask ISOLATED to execute arbitrary `chrome.*` APIs.
 */

const CHANNEL = 'ytao:v1';

/**
 * Minimal interface bridge uses from `window`.
 *
 * Exists to allow injecting target in tests: `event.source === window`
 * is correct check in a browser, but in simulated DOM environments global
 * `window` is not identical to object ending up in `event.source`.
 * Better to parameterize target than weaken check.
 */
export interface BridgeTarget {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
    options: { signal: AbortSignal },
  ): void;
  readonly location: { readonly origin: string };
}

/** MAIN → ISOLATED. Closed set. */
export type MainToIsolated = { readonly kind: 'hello'; readonly token: string };

/** ISOLATED → MAIN. Closed set. */
export type IsolatedToMain = { readonly kind: 'set-enabled'; readonly enabled: boolean };

interface Envelope {
  readonly __ytao: typeof CHANNEL;
  readonly token: string;
  readonly payload: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.__ytao === CHANNEL && typeof record.token === 'string';
}

function post(target: BridgeTarget, token: string, payload: MainToIsolated | IsolatedToMain): void {
  const envelope: Envelope = { __ytao: CHANNEL, token, payload };
  target.postMessage(envelope, target.location.origin);
}

/** All origin checks in a single place. */
function accepts(
  target: BridgeTarget,
  event: MessageEvent,
): event is MessageEvent & { data: Envelope } {
  if (event.source !== target) return false;
  if (event.origin !== target.location.origin) return false;
  return isEnvelope(event.data);
}

function listen(
  target: BridgeTarget,
  token: string,
  onMessage: (payload: unknown) => void,
  signal: AbortSignal,
): void {
  target.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (!accepts(target, event)) return;
      if (event.data.token !== token) return;
      onMessage(event.data.payload);
    },
    { signal },
  );
}

function isKind<K extends string>(payload: unknown, kind: K): boolean {
  return (
    typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === kind
  );
}

/**
 * MAIN side. Generates token and announces with `hello`.
 * Token starts in MAIN world because it runs first
 * (`document_start`, before ISOLATED in some paths).
 */
export function createMainBridge(
  onSetEnabled: (enabled: boolean) => void,
  signal: AbortSignal,
  target: BridgeTarget = window,
): { send: (message: MainToIsolated) => void; token: string } {
  const token = generateToken();

  listen(
    target,
    token,
    (payload) => {
      if (isKind(payload, 'set-enabled')) {
        const enabled = (payload as IsolatedToMain).enabled;
        if (typeof enabled === 'boolean') onSetEnabled(enabled);
      }
    },
    signal,
  );

  const send = (message: MainToIsolated): void => post(target, token, message);
  send({ kind: 'hello', token });
  return { send, token };
}

/**
 * ISOLATED side. Waits for MAIN world `hello` to learn token,
 * then accepts and sends only messages carrying it.
 */
export function createIsolatedBridge(
  onMessage: (message: MainToIsolated) => void,
  signal: AbortSignal,
  target: BridgeTarget = window,
): { send: (message: IsolatedToMain) => void } {
  let token: string | null = null;
  const pending: IsolatedToMain[] = [];

  target.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (!accepts(target, event)) return;

      const { payload } = event.data;
      if (token === null && isKind(payload, 'hello')) {
        // Local copy: `token` is captured and reassigned variable, and its
        // type narrowing does not survive `post` call.
        const learned = event.data.token;
        token = learned;
        for (const message of pending.splice(0)) post(target, learned, message);
        return;
      }
      if (token === null || event.data.token !== token) return;
      if (typeof payload === 'object' && payload !== null && 'kind' in payload) {
        onMessage(payload as MainToIsolated);
      }
    },
    { signal },
  );

  return {
    send: (message: IsolatedToMain): void => {
      if (token === null) pending.push(message);
      else post(target, token, message);
    },
  };
}

function generateToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ytao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
