import { defineConfig } from 'wxt';

/**
 * PLAN.md §13 — permessi al minimo.
 *
 * Deliberatamente NON chiediamo:
 *  - `tabs`       → host_permissions su youtube.com ci dà già `tab.url` per
 *                   quegli host, che è tutto ciò che ci serve.
 *  - `activeTab`  → `action.onClicked` consegna già la tab nel callback.
 *  - `scripting`  → i content script sono dichiarativi, nessuna injection.
 *  - `webRequest` → bug #9 dell'originale: dichiarato e mai usato.
 *  - `*://*.googlevideo.com/*` → non facciamo NESSUNA richiesta di rete.
 */
export default defineConfig({
  srcDir: '.',
  modulesDir: 'wxt-modules',
  manifest: {
    name: '__MSG_extName__',
    short_name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    permissions: ['storage'],
    host_permissions: ['*://www.youtube.com/*', '*://music.youtube.com/*'],
    action: {
      default_title: 'YouTube Bandwidth Saver',
    },
    commands: {
      'toggle-audio-only': {
        suggested_key: { default: 'Alt+A' },
        description: 'Attiva/disattiva il risparmio banda nella scheda corrente',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'yt-bandwidth-saver@robertoreale.dev',
        strict_min_version: '128.0',
      },
    },
  },
});
