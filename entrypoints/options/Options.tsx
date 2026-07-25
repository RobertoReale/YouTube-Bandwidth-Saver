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
    return <div class="loading">Caricamento impostazioni...</div>;
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
        <p class="subtitle">Impostazioni avanzate</p>
      </header>

      <section class="settings-group">
        <label class="setting-item">
          <div class="setting-info">
            <span class="setting-title">Pulsante nel player</span>
            <span class="setting-desc">
              Mostra il pulsante di attivazione rapida direttamente nel player di YouTube.
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
            <span class="setting-title">Miniatura in background</span>
            <span class="setting-desc">
              Mostra la copertina del video sfocata sullo sfondo (consuma ~50 KB di dati extra).
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
            <span class="setting-title">Attiva automaticamente su YouTube Music</span>
            <span class="setting-desc">
              Considera YouTube Music come sempre attivo per risparmiare banda.
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
        <div class={`save-toast ${saved ? 'visible' : ''}`}>Modifiche salvate automaticamente</div>
      </footer>
    </div>
  );
}
