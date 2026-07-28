// One-off local helper: converts a cookie export from your everyday (non-automated)
// Chrome — taken while logged into a throwaway Google account — into the
// storageState format Playwright expects, base64-encoded and ready to paste into
// the YOUTUBE_STORAGE_STATE_B64 GitHub Actions secret.
//
// Google refuses to let you sign in *inside* an automated/CDP-controlled browser
// ("This browser or app may not be secure"), so the session has to come from a
// real browsing session instead.
//
// How to produce the input file:
//   1. In your normal Chrome, install the "Cookie-Editor" extension
//      (https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm).
//   2. Log into a throwaway Google account and open youtube.com; confirm a video plays.
//   3. Click the Cookie-Editor icon > Export > Export as JSON (copies to clipboard).
//   4. Paste the clipboard contents into a file, e.g. cookies.json.
//
// Then run:
//   node tests/generate-youtube-session.mjs cookies.json
import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node tests/generate-youtube-session.mjs <cookies.json>');
  console.error('See the comment at the top of this file for how to produce cookies.json.');
  process.exit(1);
}

const sameSiteMap = {
  no_restriction: 'None',
  unspecified: 'Lax',
  lax: 'Lax',
  strict: 'Strict',
};

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const cookies = raw.map((c) => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path ?? '/',
  expires: c.session ? -1 : Math.round(c.expirationDate ?? -1),
  httpOnly: !!c.httpOnly,
  secure: !!c.secure,
  sameSite: sameSiteMap[c.sameSite] ?? 'Lax',
}));

const base64 = Buffer.from(JSON.stringify({ cookies, origins: [] })).toString('base64');

console.log(`\nConverted ${cookies.length} cookies.`);
console.log('\n--- Copy everything below into the YOUTUBE_STORAGE_STATE_B64 GitHub secret ---\n');
console.log(base64);
console.log('\n--- end ---\n');
