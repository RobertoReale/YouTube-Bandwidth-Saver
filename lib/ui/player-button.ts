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

function findElementBySelectors(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/**
 * RF-3: Button inside YouTube player.
 * Injected into .ytp-right-controls, survives SPA navigations.
 */
export function createPlayerButton(options: PlayerButtonOptions): PlayerButton {
  let buttonEl: HTMLButtonElement | null = null;
  let isEnabled = false;

  const injectButton = (): void => {
    if (options.signal.aborted) return;
    if (buttonEl && options.root.body.contains(buttonEl)) return;

    const rightControls = findElementBySelectors(options.root, DOM.rightControls);
    if (!rightControls) return;

    buttonEl = options.root.createElement('button');
    buttonEl.className = 'ytp-button yt-bandwidth-saver-btn';
    buttonEl.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
    buttonEl.setAttribute('title', 'Bandwidth Saver (Alt+A)');
    buttonEl.innerHTML = isEnabled ? ICONS.bandwidthSaver : ICONS.bandwidthSaverOff;

    buttonEl.addEventListener(
      'click',
      () => {
        options.onClick();
      },
      { signal: options.signal },
    );

    const settingsButton = findElementBySelectors(rightControls, DOM.settingsButton);
    if (settingsButton) {
      rightControls.insertBefore(buttonEl, settingsButton);
    } else {
      rightControls.appendChild(buttonEl);
    }
  };

  // Observe tree to inject button when player appears
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

  // Re-inject after SPA navigation
  options.root.defaultView?.addEventListener(
    YT_EVENTS.navigateFinish,
    () => {
      // Small delay because controls might be redrawn by YouTube
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
