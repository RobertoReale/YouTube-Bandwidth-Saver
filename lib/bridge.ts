/**
 * PLAN.md §8 — ponte ISOLATED ↔ MAIN.
 *
 * `window.postMessage` è visibile alla pagina e a qualsiasi altro script, quindi:
 *  - ogni messaggio porta un token generato per sessione;
 *  - `event.source === window` e `event.origin` sono sempre verificati;
 *  - l'insieme dei comandi è CHIUSO, mai un dispatch generico;
 *  - qui passano solo flag di configurazione, nessun dato sensibile.
 *
 * Onestà sul modello di minaccia: il token non è un segreto verso la pagina —
 * nel MAIN world la pagina può leggere tutto ciò che teniamo in memoria. Serve a
 * escludere collisioni con altri script e forgiature casuali. La vera difesa è
 * che il comando più potente di questo canale accende o spegne l'audio-only, e
 * il MAIN world non può chiedere all'ISOLATED di eseguire `chrome.*` arbitrarie.
 */

const CHANNEL = 'ytao:v1';

/**
 * Il minimo che il ponte usa di `window`.
 *
 * Esiste per poter iniettare il bersaglio nei test: `event.source === window`
 * è il controllo corretto in un browser, ma negli ambienti DOM simulati il
 * `window` globale non è identico all'oggetto che finisce in `event.source`.
 * Meglio parametrizzare il bersaglio che allentare il controllo.
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

/** MAIN → ISOLATED. Insieme chiuso. */
export type MainToIsolated =
  | { readonly kind: 'hello'; readonly token: string }
  | {
      readonly kind: 'filter-applied';
      readonly videoId: string | null;
      readonly bytesSaved: number;
    }
  | { readonly kind: 'filter-skipped'; readonly reason: string; readonly isLive: boolean };

/** ISOLATED → MAIN. Insieme chiuso. */
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

/** Tutti i controlli di provenienza in un solo punto. */
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
 * Lato MAIN. Genera il token e lo annuncia con `hello`.
 * Il token nasce nel MAIN world perché è il lato che parte prima
 * (`document_start`, prima dell'ISOLATED in alcuni percorsi).
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
 * Lato ISOLATED. Attende l'`hello` del MAIN world per apprendere il token,
 * poi accetta e invia solo messaggi che lo portano.
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
        // Copia locale: `token` è una variabile catturata e riassegnata, e la
        // sua restrizione di tipo non sopravvive alla chiamata a `post`.
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
