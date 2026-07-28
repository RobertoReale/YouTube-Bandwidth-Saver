import path from 'node:path';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());
const extensionPath = path.resolve('.output/chrome-mv3');

const videos = [
  { name: 'Normal', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { name: 'Short', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  { name: 'Music Video', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' }, // Despacito
  { name: 'YouTube Music', url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk' },
];

(async () => {
  console.log(`Launching Chromium with extension from: ${extensionPath}`);

  const browserContext = await chromium.launchPersistentContext('', {
    headless: false, // MV3 extensions often require headful, and automation on YT works better
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

  // Wait for the extension to initialize and open its options page
  // We wait until a second page is created (the options page) or a timeout occurs
  for (let i = 0; i < 10; i++) {
    if (browserContext.pages().length > 1) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1000)); // Give it a moment to settle
  
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

  // Handle consent dialog by clicking button instead of cookies

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

      // Check quality set by player
      const quality = await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        return player?.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';
      });
      console.log(`Playback quality: ${quality}`);

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
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) video.currentTime += 30;
      });

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
        console.error('❌ Player broke after seek.');
        failed = true;
        break;
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
