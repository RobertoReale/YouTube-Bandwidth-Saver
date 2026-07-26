import { defineConfig } from 'wxt';

/**
 * PLAN.md §13 — minimal permissions.
 *
 * Deliberately NOT asking for:
 *  - `tabs`       → host_permissions on youtube.com already gives `tab.url` for
 *                   those hosts, which is all we need.
 *  - `activeTab`  → `action.onClicked` already delivers tab in callback.
 *  - `scripting`  → content scripts are declarative, no injection.
 *  - `webRequest` → original bug #9: declared and never used.
 *  - `*://*.googlevideo.com/*` → we make NO network requests.
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
        description: 'Toggle bandwidth saver in current tab',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'yt-bandwidth-saver@robertoreale.dev',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
