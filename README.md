# YouTube Bandwidth Saver

Browser extension (MV3) that **minimizes** YouTube video streams to drastically save bandwidth, hiding low-quality video behind an elegant "Audio Only" interface while leaving audio and all native player controls fully intact.

**Status: Release Ready.**

## How it works

YouTube uses SABR (Server-Advised Bitrate) to dynamically negotiate video quality server-side. Any attempt to intercept and strip video tracks client-side results in player errors (403).

To bypass this constraint safely (Plan C), the extension **intercepts HTML5 player APIs on startup**, forcing quality to `tiny` (144p). The low-resolution video is then covered by a visual overlay. As a result:
1. Video bandwidth consumption drops drastically (just a fraction of a Megabyte).
2. The player operates smoothly without abnormal interruptions—everything works: seeking, buffering, playlists, and continuous playback.

## What it does NOT do, by design

- **No custom network requests.** No extra fetches for watch pages, `base.js`, or HEAD verification requests.
- **No network interception.** To avoid triggering YouTube's anti-adblock systems, we do not monkeypatch `fetch`, `XMLHttpRequest`, or global variables like `ytInitialPlayerResponse`. We use native HTML5 player APIs instead.
- **No `eval`, no remote code.** We do not reconstruct URLs or decipher signatures; YouTube handles media delivery natively.
- **No server telemetry.** Saved MB counters and logs are stored *strictly locally* (`storage.session` and `storage.local`). No data ever leaves your device.
- **No downloading, no ad blocking.** Out of scope for a focused utility extension. (We recommend uBlock Origin Lite if you want to block video ads).

## Development

```bash
pnpm install
pnpm dev        # Chrome with HMR and hot reload
pnpm build      # production build in .output/chrome-mv3
pnpm check      # lint + typecheck + test
pnpm test       # vitest run
pnpm zip        # generates store-ready zip packages
```

### Loading the build in Chrome

```
chrome://extensions → Developer mode → Load unpacked
→ select .output/chrome-mv3
```

## Features & UI

- **Popup UI**: Choose between "Always Active", "Per Tab", or "Disabled".
- **Visual Overlay**: Covers low-resolution video with a sleek background or optional thumbnail.
- **Keyboard Shortcut**: Press `Alt+A` to toggle instantly.

## Privacy

Zero data collection. The extension performs no network requests and sends nothing to us or third parties.
Permissions requested: `storage` for your settings, and host permissions for `www.youtube.com` / `music.youtube.com` to inject the player interface.
