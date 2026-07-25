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

  const updateSetting = async (key: keyof Settings, value: boolean) => {
    const next = await setSettings({ [key]: value });
    setSettingsState(next);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div class="options-container">
      <header class="header">
        <h1>YouTube Bandwidth Saver</h1>
        <p class="subtitle">Advanced settings</p>
      </header>

      <section class="settings-group">
        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">In-player button</span>
            <span class="setting-desc">
              Show quick toggle button directly inside the YouTube player.
            </span>
          </div>
          <div class="setting-control">
            <input
              type="checkbox"
              class="toggle-input"
              checked={settings.showPlayerButton}
              onChange={(e) =>
                updateSetting('showPlayerButton', (e.target as HTMLInputElement).checked)
              }
            />
          </div>
        </label>

        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Background thumbnail</span>
            <span class="setting-desc">
              Show blurred video thumbnail in background (uses ~50 KB extra data).
            </span>
          </div>
          <div class="setting-control">
            <input
              type="checkbox"
              class="toggle-input"
              checked={settings.showThumbnail}
              onChange={(e) =>
                updateSetting('showThumbnail', (e.target as HTMLInputElement).checked)
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
