import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { getSettings, setSettings } from '../../lib/settings';
import type { Mode, Settings } from '../../lib/types';

export function Popup() {
  const [settings, setSettingsState] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setSettingsState);
  }, []);

  if (!settings) {
    return <div class="loading">Caricamento...</div>;
  }

  const handleModeChange = async (mode: Mode) => {
    const next = await setSettings({ mode });
    setSettingsState(next);
  };

  return (
    <div class="popup-container">
      <header class="header">
        <h1>Bandwidth Saver</h1>
      </header>

      <section class="mode-selector">
        <label class={`mode-option ${settings.mode === 'always' ? 'active' : ''}`}>
          <input
            type="radio"
            name="mode"
            value="always"
            checked={settings.mode === 'always'}
            onChange={() => handleModeChange('always')}
          />
          <div class="mode-info">
            <span class="mode-title">Sempre Attivo</span>
            <span class="mode-desc">Risparmia su tutti i video</span>
          </div>
        </label>

        <label class={`mode-option ${settings.mode === 'per-tab' ? 'active' : ''}`}>
          <input
            type="radio"
            name="mode"
            value="per-tab"
            checked={settings.mode === 'per-tab'}
            onChange={() => handleModeChange('per-tab')}
          />
          <div class="mode-info">
            <span class="mode-title">Per Scheda</span>
            <span class="mode-desc">Attiva/disattiva col pulsante</span>
          </div>
        </label>

        <label class={`mode-option ${settings.mode === 'off' ? 'active' : ''}`}>
          <input
            type="radio"
            name="mode"
            value="off"
            checked={settings.mode === 'off'}
            onChange={() => handleModeChange('off')}
          />
          <div class="mode-info">
            <span class="mode-title">Spento</span>
            <span class="mode-desc">Video in qualità normale</span>
          </div>
        </label>
      </section>

      <footer class="footer">
        <button type="button" class="options-btn" onClick={() => browser.runtime.openOptionsPage()}>
          Impostazioni avanzate
        </button>
      </footer>
    </div>
  );
}
