import { DOM } from '../selectors';

export interface OverlayOptions {
  readonly root: Document;
  readonly signal: AbortSignal;
}

export interface Overlay {
  readonly updateState: (enabled: boolean) => void;
}

/**
 * Visual overlay to cover the 144p stream.
 */
export function createOverlay(options: OverlayOptions): Overlay {
  let overlayEl: HTMLDivElement | null = null;
  let currentEnabled = false;

  const injectOverlay = (): void => {
    if (options.signal.aborted) return;

    // Find video container
    let videoContainer: Element | null = null;
    for (const selector of DOM.moviePlayer) {
      videoContainer = options.root.querySelector(selector);
      if (videoContainer) break;
    }

    if (!videoContainer) return;

    if (!overlayEl) {
      overlayEl = options.root.createElement('div');
      overlayEl.className = 'yt-bandwidth-saver-overlay';
      overlayEl.innerHTML = `
        <div class="yt-bandwidth-saver-bg"></div>
        <div class="yt-bandwidth-saver-content">
          <div class="yt-bandwidth-saver-icon"></div>
          <div class="yt-bandwidth-saver-text">Bandwidth Saver Active</div>
        </div>
      `;
      // Insert overlay inside player, behind native controls.
      // A good place is before controls container.
      videoContainer.appendChild(overlayEl);
    }

    renderState();
  };

  const renderState = () => {
    if (!overlayEl) return;

    if (!currentEnabled) {
      overlayEl.style.display = 'none';
      return;
    }

    overlayEl.style.display = 'flex';

    const bg = overlayEl.querySelector('.yt-bandwidth-saver-bg') as HTMLDivElement;
    const text = overlayEl.querySelector('.yt-bandwidth-saver-text') as HTMLDivElement;

    text.innerHTML =
      'Bandwidth Saver Active<br><span style="font-size: 12px; opacity: 0.7; display: block; margin-top: 8px; font-weight: normal;">(Right-click extension icon for options)</span>';
    bg.style.backgroundImage = 'none';
    bg.style.backgroundColor = 'rgba(0,0,0,0.8)';
  };

  const observer = new MutationObserver(() => {
    if (currentEnabled && (!overlayEl || !options.root.body.contains(overlayEl))) {
      injectOverlay();
    }
  });

  observer.observe(options.root.documentElement, {
    childList: true,
    subtree: true,
  });

  options.signal.addEventListener('abort', () => {
    observer.disconnect();
    overlayEl?.remove();
    overlayEl = null;
  });

  return {
    updateState(enabled: boolean) {
      currentEnabled = enabled;

      if (enabled && !overlayEl) {
        injectOverlay();
      } else {
        renderState();
      }
    },
  };
}
