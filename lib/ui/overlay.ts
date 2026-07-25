import { DOM } from '../selectors';

export interface OverlayOptions {
  readonly root: Document;
  readonly signal: AbortSignal;
}

export interface Overlay {
  readonly updateState: (enabled: boolean, isLive: boolean, thumbnailUrl?: string) => void;
}

/**
 * RF-4: Overlay visivo per coprire lo stream a 144p.
 */
export function createOverlay(options: OverlayOptions): Overlay {
  let overlayEl: HTMLDivElement | null = null;
  let currentEnabled = false;
  let currentIsLive = false;
  let currentThumbnail = '';

  const injectOverlay = (): void => {
    if (options.signal.aborted) return;

    // Troviamo il container del video
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
          <div class="yt-bandwidth-saver-text">Bandwidth Saver Attivo</div>
        </div>
      `;
      // Inseriamo l'overlay all'interno del player, dietro ai controlli nativi.
      // Un buon punto è prima del contenitore dei controlli.
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

    if (currentIsLive) {
      text.textContent = 'Risparmio Banda non disponibile sulle dirette';
      bg.style.backgroundImage = 'none';
      bg.style.backgroundColor = 'rgba(0,0,0,0.8)';
    } else {
      text.textContent = 'Bandwidth Saver Attivo';
      if (currentThumbnail) {
        bg.style.backgroundImage = `url("${currentThumbnail}")`;
      } else {
        bg.style.backgroundImage = 'none';
        bg.style.backgroundColor = 'rgba(0,0,0,0.8)';
      }
    }
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
    updateState(enabled: boolean, isLive: boolean, thumbnailUrl?: string) {
      currentEnabled = enabled;
      currentIsLive = isLive;
      if (thumbnailUrl) currentThumbnail = thumbnailUrl;

      if (enabled && !overlayEl) {
        injectOverlay();
      } else {
        renderState();
      }
    },
  };
}
