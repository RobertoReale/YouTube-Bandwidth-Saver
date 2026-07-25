import { DOM, YT_EVENTS } from '../selectors';
import { ICONS } from './icons';

export interface PlayerButtonOptions {
  readonly root: Document;
  readonly signal: AbortSignal;
  readonly onClick: () => void;
}

export interface PlayerButton {
  readonly updateState: (enabled: boolean) => void;
}

/**
 * RF-3: Pulsante nel player YouTube.
 * Iniettato in .ytp-right-controls, sopravvive alle navigazioni SPA.
 */
export function createPlayerButton(options: PlayerButtonOptions): PlayerButton {
  let buttonEl: HTMLButtonElement | null = null;
  let isEnabled = false;

  const injectButton = (): void => {
    if (options.signal.aborted) return;
    if (buttonEl && options.root.body.contains(buttonEl)) return;

    // Troviamo i controlli destri
    let rightControls: Element | null = null;
    for (const selector of DOM.rightControls) {
      rightControls = options.root.querySelector(selector);
      if (rightControls) break;
    }

    if (!rightControls) return;

    // Crea il bottone
    buttonEl = options.root.createElement('button');
    buttonEl.className = 'ytp-button yt-bandwidth-saver-btn';
    buttonEl.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
    buttonEl.setAttribute('title', 'Risparmio Banda (Alt+A)');

    buttonEl.innerHTML = isEnabled ? ICONS.bandwidthSaver : ICONS.bandwidthSaverOff;

    buttonEl.addEventListener(
      'click',
      () => {
        options.onClick();
      },
      { signal: options.signal },
    );

    // Inseriamo prima del bottone impostazioni se esiste, altrimenti in fondo
    let settingsButton: Element | null = null;
    for (const selector of DOM.settingsButton) {
      settingsButton = rightControls.querySelector(selector);
      if (settingsButton) break;
    }

    if (settingsButton) {
      rightControls.insertBefore(buttonEl, settingsButton);
    } else {
      rightControls.appendChild(buttonEl);
    }
  };

  // Osserva l'albero per iniettare il bottone quando appare il player
  const observer = new MutationObserver(() => {
    injectButton();
  });

  observer.observe(options.root.documentElement, {
    childList: true,
    subtree: true,
  });

  options.signal.addEventListener('abort', () => {
    observer.disconnect();
    buttonEl?.remove();
    buttonEl = null;
  });

  // Re-inietta dopo SPA navigation
  options.root.defaultView?.addEventListener(
    YT_EVENTS.navigateFinish,
    () => {
      // Un piccolo delay perché i controlli potrebbero essere ridisegnati da YouTube
      setTimeout(injectButton, 500);
    },
    { signal: options.signal },
  );

  injectButton();

  return {
    updateState(enabled: boolean) {
      isEnabled = enabled;
      if (buttonEl) {
        buttonEl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        buttonEl.innerHTML = enabled ? ICONS.bandwidthSaver : ICONS.bandwidthSaverOff;
      }
    },
  };
}
