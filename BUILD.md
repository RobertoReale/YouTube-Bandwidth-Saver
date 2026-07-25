# Build Instructions (Reproducible Build)

To guarantee transparency and security for extension store listings, here are the exact steps to generate package zips (`.zip`) identical to published releases.

## Requirements

- Node.js >= 20
- pnpm >= 8.0.0

## Steps

1. Clone repository:
   ```bash
   git clone https://github.com/RobertoReale/YouTube-Bandwidth-Saver.git
   cd YouTube-Bandwidth-Saver
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Create package for Chrome/Edge:
   ```bash
   pnpm zip
   ```
   *The output package will be located at `.output/YouTube-Bandwidth-Saver-chrome.zip`.*

4. Create package for Firefox:
   ```bash
   pnpm zip -b firefox
   ```
   *The output package will be located at `.output/YouTube-Bandwidth-Saver-firefox.zip`.*

## Integrity Verification
Because the extension uses WXT, source code is compiled and bundled for optimal performance. The complete original TypeScript source code is fully inspectable in this GitHub repository at the commit tag matching each release version.
