import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());
const extensionPath = path.resolve('.output/chrome-mv3');

// Qualities the extension should force — tiny=144p, small=240p
const ACCEPTABLE_QUALITIES = new Set(['tiny', 'small']);

const videos = [
  { name: 'Normal', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { name: 'Short', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  { name: 'Music Video', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' }, // Despacito
  { name: 'YouTube Music', url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk' },
];

(async () => {
  console.log(`Launching Chromium with extension from: ${extensionPath}`);

  // An authenticated Google session almost never sees YouTube's anonymous-traffic
  // "Sign in to confirm you're not a bot" check. Populate YOUTUBE_STORAGE_STATE_B64
  // (base64 of a Playwright storageState.json from a throwaway account) as a CI
  // secret to enable it; the test falls back to an anonymous session otherwise.
  let storageStatePath;
  if (process.env.YOUTUBE_STORAGE_STATE_B64) {
    storageStatePath = path.join(os.tmpdir(), `yt-storage-state-${Date.now()}.json`);
    fs.writeFileSync(storageStatePath, Buffer.from(process.env.YOUTUBE_STORAGE_STATE_B64, 'base64'));
    console.log('Using authenticated YouTube session from YOUTUBE_STORAGE_STATE_B64.');
  } else {
    console.log('No YOUTUBE_STORAGE_STATE_B64 provided; using an anonymous session.');
  }

  const browserContext = await chromium.launchPersistentContext('', {
    headless: false, // MV3 extensions often require headful, and automation on YT works better
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--mute-audio',
      '--disable-background-media-suspend',
      '--disable-background-timer-throttling',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
    ],
    locale: 'en-US',
  });

  if (storageStatePath) {
    fs.unlink(storageStatePath, () => {});
  }

  // Wait for the extension to initialize and open its options page
  // We wait until a second page is created (the options page) or a timeout occurs
  for (let i = 0; i < 10; i++) {
    if (browserContext.pages().length > 1) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1000)); // Give it a moment to settle

  // ── Set extension to "always" mode via service worker ──
  // The extension uses chrome.storage.sync with key "settings".
  // Default mode is "per-tab" which means the extension is OFF on new tabs.
  // We need "always" so it forces low quality on every video.
  let extensionConfigured = false;
  const swTarget = browserContext.serviceWorkers();
  if (swTarget.length > 0) {
    try {
      await swTarget[0].evaluate(() => {
        return chrome.storage.sync.set({
          settings: { mode: 'always', showOverlay: true, autoEnableOnMusic: true },
        });
      });
      console.log('✅ Extension configured: mode="always" via service worker.');
      extensionConfigured = true;
    } catch (e) {
      console.warn('⚠️  Could not configure extension via service worker:', e.message);
    }
  } else {
    console.warn('⚠️  No service worker found. Trying via background page...');
  }

  // Fallback: try background pages if service workers didn't work
  if (!extensionConfigured) {
    const bgPages = browserContext.backgroundPages();
    if (bgPages.length > 0) {
      try {
        await bgPages[0].evaluate(() => {
          return chrome.storage.sync.set({
            settings: { mode: 'always', showOverlay: true, autoEnableOnMusic: true },
          });
        });
        console.log('✅ Extension configured: mode="always" via background page.');
        extensionConfigured = true;
      } catch (e) {
        console.warn('⚠️  Could not configure extension via background page:', e.message);
      }
    }
  }

  if (!extensionConfigured) {
    console.error('❌ Could not configure extension mode. Test results may be invalid.');
  }

  // Give the extension a moment to react to the settings change
  await new Promise(r => setTimeout(r, 1000));

  const initialPages = browserContext.pages();
  const page = await browserContext.newPage();
  
  // Close the initial page(s) (including options page) so we only use the newly created one, which has stealth applied.
  for (const p of initialPages) {
    await p.close().catch(() => {});
  }

  // Ad blocking via route to avoid YouTube ads blocking playback
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.includes('doubleclick.net') ||
      url.includes('googleadservices.com') ||
      url.includes('googlesyndication.com') ||
      url.includes('/pagead/') ||
      url.includes('/api/stats/ads') ||
      url.includes('youtube.com/ptracking')
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  let failed = false;

  for (const video of videos) {
    console.log(`\n--- Testing ${video.name}: ${video.url} ---`);
    try {
      try {
        await page.goto(video.url, { waitUntil: 'domcontentloaded' });
      } catch (err) {
        if (err.message.includes('interrupted by another navigation')) {
          console.log('Navigation interrupted (likely by extension options page), retrying...');
          await page.waitForTimeout(1000);
          await page.goto(video.url, { waitUntil: 'domcontentloaded' });
        } else {
          throw err;
        }
      }

      console.log('Waiting for video to start and handling any dialogs...');

      // Try clicking Reject All or Accept All if present
      try {
        const dialogButton = page.locator('button, [role="button"]').filter({ hasText: /(Reject all|Accept all|Rifiuta tutto|Accetta tutto)/i }).first();
        await dialogButton.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        
        if (await dialogButton.isVisible()) {
          await dialogButton.click({ force: true });
          console.log('Consent dialog bypassed via Playwright locator.');
          await page.waitForTimeout(2000); // Wait for dialog animation to finish
        } else {
          console.log('No consent dialog found to bypass.');
        }
      } catch (e) {
        console.log('Could not bypass consent dialog:', e.message);
      }

      // Detect YouTube bot-check ("Sign in to confirm you're not a bot")
      const botBlocked = await page.evaluate(() => {
        const body = document.body?.innerText || '';
        return body.includes('Sign in to confirm') || body.includes('confirm you\'re not a bot');
      }).catch(() => false);

      if (botBlocked) {
        console.warn('⚠️  YouTube is showing "Sign in to confirm you\'re not a bot".');
        console.warn('⚠️  This is a YouTube bot-detection issue, not an extension problem.');
        console.warn('⚠️  Skipping E2E test gracefully.');
        await page.screenshot({ path: 'screenshot.png' });
        await browserContext.close();
        console.log('\n🟡 PLAN C SKIPPED (bot-blocked by YouTube).');
        process.exit(0);
      }

      // Wait for video to be playing and progressing
      const isPlaying = await page
        .waitForFunction(
          () => {
            const video = document.querySelector('video');
            return video && video.readyState >= 3 && !video.paused && video.currentTime > 1;
          },
          { timeout: 15000 },
        )
        .catch(() => false);

      if (!isPlaying) {
        // Double-check for bot block in case it appeared after the initial check
        const lateBotBlock = await page.evaluate(() => {
          const body = document.body?.innerText || '';
          return body.includes('Sign in to confirm') || body.includes('confirm you\'re not a bot');
        }).catch(() => false);

        if (lateBotBlock) {
          console.warn('⚠️  YouTube bot-detection appeared during playback wait.');
          console.warn('⚠️  Skipping E2E test gracefully.');
          await page.screenshot({ path: 'screenshot.png' });
          await browserContext.close();
          console.log('\n🟡 PLAN C SKIPPED (bot-blocked by YouTube).');
          process.exit(0);
        }

        await page.screenshot({ path: 'screenshot.png' });
        console.error('❌ Video did not start or got stuck. See screenshot.png.');
        failed = true;
        break;
      }
      console.log('✅ Video started and running.');

      // ── CRITICAL: Verify extension actually forced low quality ──
      // Wait a moment for the extension's quality enforcer to apply
      await page.waitForTimeout(2000);

      const quality = await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        return player?.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';
      });
      console.log(`Playback quality: ${quality}`);

      if (!ACCEPTABLE_QUALITIES.has(quality)) {
        console.error(`❌ Quality is "${quality}" but extension should have forced tiny/small!`);
        console.error('   This means the extension is NOT working correctly.');
        await page.screenshot({ path: 'screenshot.png' });
        failed = true;
        break;
      }
      console.log(`✅ Quality "${quality}" confirmed — extension is working.`);

      // Wait 5 seconds
      await page.waitForTimeout(5000);

      const isStillPlaying = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video && video.readyState >= 3 && !video.paused;
      });

      if (!isStillPlaying) {
        await page.screenshot({ path: 'screenshot-broke.png' });
        console.error('❌ Player broke after forcing quality at runtime. See screenshot-broke.png');
        failed = true;
        break;
      }

      console.log('Testing seek...');
      const seekInfo = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) return { seeked: false };
        const duration = video.duration || 0;
        const current = video.currentTime || 0;
        // Seek forward by up to 15s, but never past 1s before the end
        const seekAmount = Math.min(15, duration - current - 1);
        if (seekAmount < 2) return { seeked: false, reason: 'video too short to seek' };
        video.currentTime = current + seekAmount;
        return { seeked: true, from: current.toFixed(1), to: (current + seekAmount).toFixed(1), duration: duration.toFixed(1) };
      });
      console.log(`Seek info:`, seekInfo);

      if (!seekInfo.seeked) {
        console.log('⏭️  Skipping seek test (video too short).');
      } else {
        // Verify if playback recovers after seek
        const seekRecovered = await page
          .waitForFunction(
            () => {
              const video = document.querySelector('video');
              return video && video.readyState >= 3 && !video.paused;
            },
            { timeout: 10000 },
          )
          .catch(() => false);

        if (!seekRecovered) {
          // Check if video simply ended (not an error for short videos)
          const videoEnded = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video?.ended === true;
          }).catch(() => false);

          if (videoEnded) {
            console.log('⏭️  Video ended after seek (expected for short videos).');
          } else {
            console.error('❌ Player broke after seek.');
            failed = true;
            break;
          }
        } else {
          // Verify quality is still low after seek (extension should re-enforce)
          const postSeekQuality = await page.evaluate(() => {
            const player = document.querySelector('#movie_player');
            return player?.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';
          });
          console.log(`Post-seek quality: ${postSeekQuality}`);

          if (!ACCEPTABLE_QUALITIES.has(postSeekQuality)) {
            console.error(`❌ Quality drifted to "${postSeekQuality}" after seek! Extension lost control.`);
            failed = true;
            break;
          }
        }
      }

      // Read decoded bytes
      const stats = await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          videoMB: video ? (video.webkitVideoDecodedByteCount / 1024 / 1024).toFixed(2) : 0,
          audioMB: video ? (video.webkitAudioDecodedByteCount / 1024 / 1024).toFixed(2) : 0,
        };
      });

      console.log(
        `✅ Seek completed. Decoded bytes: Video ${stats.videoMB} MB, Audio ${stats.audioMB} MB.`,
      );
    } catch (e) {
      console.error('❌ Error while testing', video.name, e);
      failed = true;
      break;
    }
  }

  await browserContext.close();

  if (failed) {
    console.error('\n🔴 PLAN C VERIFICATION FAILED.');
    process.exit(1);
  } else {
    console.log('\n🟢 PLAN C VERIFICATION PASSED!');
    process.exit(0);
  }
})();
