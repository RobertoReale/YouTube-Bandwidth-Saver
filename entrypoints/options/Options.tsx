import { useEffect, useState } from 'preact/hooks';
import { getSettings, setSettings } from '../../lib/settings';
import type { Settings } from '../../lib/types';

export function Options() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettingsState);
  }, []);

  if (!settings) {
    return <div class="loading">Loading settings...</div>;
  }

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const patch: Partial<Settings> = { [key]: value };
    const next = await setSettings(patch);
    setSettingsState(next);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div class="options-container">
      <header class="header">
        <h1>YouTube Bandwidth Saver</h1>
        <p class="subtitle">Settings</p>
      </header>

      <section class="settings-group">
        <h2 class="group-title" style="margin-top:0; font-size: 16px; margin-bottom: 8px;">
          Operating Mode
        </h2>
        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Always Active</span>
            <span class="setting-desc">Save bandwidth on all videos</span>
          </div>
          <div class="setting-control">
            <input
              type="radio"
              name="mode"
              value="always"
              class="toggle-input"
              checked={settings.mode === 'always'}
              onChange={() => updateSetting('mode', 'always')}
            />
          </div>
        </label>

        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Manual (Per Tab)</span>
            <span class="setting-desc">Click the extension icon to toggle for the current tab</span>
          </div>
          <div class="setting-control">
            <input
              type="radio"
              name="mode"
              value="per-tab"
              class="toggle-input"
              checked={settings.mode === 'per-tab'}
              onChange={() => updateSetting('mode', 'per-tab')}
            />
          </div>
        </label>

        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Disabled</span>
            <span class="setting-desc">Videos play in normal quality</span>
          </div>
          <div class="setting-control">
            <input
              type="radio"
              name="mode"
              value="off"
              class="toggle-input"
              checked={settings.mode === 'off'}
              onChange={() => updateSetting('mode', 'off')}
            />
          </div>
        </label>
      </section>

      <section class="settings-group" style="border-top: 1px solid var(--border-color);">
        <h2 class="group-title" style="margin-top:0; font-size: 16px; margin-bottom: 8px;">
          Advanced
        </h2>

        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Show black overlay</span>
            <span class="setting-desc">
              Hides the pixelated 144p video with a clean black overlay. Disable this to see the video.
            </span>
          </div>
          <div class="setting-control">
            <input
              type="checkbox"
              class="toggle-input"
              checked={settings.showOverlay}
              onChange={(e) =>
                updateSetting('showOverlay', (e.target as HTMLInputElement).checked)
              }
            />
          </div>
        </label>

        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Auto-enable on YouTube Music</span>
            <span class="setting-desc">
              Treat YouTube Music as always active to save bandwidth.
            </span>
          </div>
          <div class="setting-control">
            <input
              type="checkbox"
              class="toggle-input"
              checked={settings.autoEnableOnMusic}
              onChange={(e) =>
                updateSetting('autoEnableOnMusic', (e.target as HTMLInputElement).checked)
              }
            />
          </div>
        </label>
      </section>

      <footer class="footer">
        <div class={`save-toast ${saved ? 'visible' : ''}`}>Settings saved automatically</div>
      </footer>
    </div>
  );
}
