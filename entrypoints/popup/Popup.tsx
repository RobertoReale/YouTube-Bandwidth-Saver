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
    return <div class="loading">Loading...</div>;
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
            <span class="mode-title">Always Active</span>
            <span class="mode-desc">Save bandwidth on all videos</span>
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
            <span class="mode-title">Per Tab</span>
            <span class="mode-desc">Toggle with button</span>
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
            <span class="mode-title">Disabled</span>
            <span class="mode-desc">Videos in normal quality</span>
          </div>
        </label>
      </section>

      <footer class="footer">
        <button type="button" class="options-btn" onClick={() => browser.runtime.openOptionsPage()}>
          Advanced settings
        </button>
      </footer>
    </div>
  );
}
