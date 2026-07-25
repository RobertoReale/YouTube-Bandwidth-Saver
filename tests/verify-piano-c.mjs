import path from 'node:path';
import { chromium } from 'playwright';

const extensionPath = path.resolve('.output/chrome-mv3');

const videos = [
  { name: 'Normale', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { name: 'Corto', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  { name: 'Musicale', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' }, // Despacito
  { name: 'Music', url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk' },
];

(async () => {
  console.log(`Lancio Chromium con estensione da: ${extensionPath}`);

  const browserContext = await chromium.launchPersistentContext('', {
    headless: false, // Le estensioni in MV3 spesso richiedono headful, e l'automazione su YT funziona meglio
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--mute-audio',
    ],
  });

  const page = await browserContext.newPage();

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

  // Gestiremo il consent dialog cliccando sul bottone invece dei cookie

  let failed = false;

  for (const video of videos) {
    console.log(`\n--- Testando ${video.name}: ${video.url} ---`);
    try {
      await page.goto(video.url, { waitUntil: 'domcontentloaded' });

      console.log('Attendo che il video parta e gestisco eventuali dialog...');

      // Prova a cliccare su Reject All o Accept All se presente
      try {
        const rejectBtn = page
          .locator(
            'button:has-text("Reject all"), button:has-text("Rifiuta tutto"), button:has-text("Accept all"), button:has-text("Accetta tutto")',
          )
          .first();
        await rejectBtn.waitFor({ state: 'visible', timeout: 5000 });
        await rejectBtn.click();
        console.log('Dialog del consenso superato.');
      } catch (_e) {
        // Nessun dialog visibile
      }

      // Aspetta che il video sia playing e avanzi
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
        await page.screenshot({ path: 'screenshot.png' });
        console.error('❌ Il video non parte o si è bloccato. Guarda screenshot.png.');
        failed = true;
        break;
      }
      console.log('✅ Video partito e in esecuzione.');

      // Controllo la qualità impostata dal player
      const quality = await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        return player?.getPlaybackQuality ? player.getPlaybackQuality() : 'sconosciuta';
      });
      console.log(`Qualità in riproduzione: ${quality}`);

      // Aspetto 5 secondi
      await page.waitForTimeout(5000);

      const isStillPlaying = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video && video.readyState >= 3 && !video.paused;
      });

      if (!isStillPlaying) {
        console.error('❌ Il player si è rotto dopo aver forzato la qualità a runtime.');
        failed = true;
        break;
      }

      console.log('Testo il seek...');
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) video.currentTime += 30;
      });

      // Verifica se riprende dopo il seek
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
        console.error('❌ Il player si è rotto dopo il seek.');
        failed = true;
        break;
      }

      // Leggi byte decodificati
      const stats = await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          videoMB: video ? (video.webkitVideoDecodedByteCount / 1024 / 1024).toFixed(2) : 0,
          audioMB: video ? (video.webkitAudioDecodedByteCount / 1024 / 1024).toFixed(2) : 0,
        };
      });

      console.log(
        `✅ Seek completato. Byte decodificati: Video ${stats.videoMB} MB, Audio ${stats.audioMB} MB.`,
      );
    } catch (e) {
      console.error('❌ Errore durante il test di', video.name, e);
      failed = true;
      break;
    }
  }

  await browserContext.close();

  if (failed) {
    console.error('\n🔴 IL PIANO C HA FALLITO LA VERIFICA.');
  } else {
    console.log('\n🟢 IL PIANO C HA SUPERATO LA VERIFICA!');
  }
})();
