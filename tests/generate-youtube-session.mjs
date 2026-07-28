// One-off local helper: log into YouTube with a throwaway Google account in a
// real browser window, then dump the session as a base64 string ready to paste
// into the YOUTUBE_STORAGE_STATE_B64 GitHub Actions secret. Run with:
//   node tests/generate-youtube-session.mjs
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube');

  console.log('\nA browser window has opened.');
  console.log('1. Log into the throwaway Google account you want CI to use.');
  console.log('2. Navigate to youtube.com and make sure a video plays normally.');
  console.log('3. Come back here and press Enter to export the session.\n');

  await new Promise((resolve) => process.stdin.once('data', resolve));

  const storageState = await context.storageState();
  const base64 = Buffer.from(JSON.stringify(storageState)).toString('base64');

  console.log('\n--- Copy everything below into the YOUTUBE_STORAGE_STATE_B64 GitHub secret ---\n');
  console.log(base64);
  console.log('\n--- end ---\n');

  await browser.close();
  process.exit(0);
})();
