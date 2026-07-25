# Istruzioni di Build (Riproducibile)

Per garantire la trasparenza e la sicurezza del codice caricato sui web store, ecco le istruzioni esatte per generare un pacchetto (`.zip`) identico a quello pubblicato.

## Requisiti

- Node.js >= 20
- pnpm >= 8.0.0

## Procedura

1. Clona il repository:
   ```bash
   git clone https://github.com/TuoNome/yt-bandwidth-saver.git
   cd yt-bandwidth-saver
   ```

2. Installa le dipendenze:
   ```bash
   pnpm install
   ```

3. Crea il pacchetto per Chrome/Edge:
   ```bash
   pnpm zip
   ```
   *Il file risultante si troverà in `.output/yt-bandwidth-saver-chrome.zip`.*

4. Crea il pacchetto per Firefox:
   ```bash
   pnpm zip -b firefox
   ```
   *Il file risultante si troverà in `.output/yt-bandwidth-saver-firefox.zip`.*

## Verifica dell'Integrità
Poiché l'estensione utilizza WXT, il codice sorgente viene compilato e parzialmente minificato per questioni di performance. L'intero codice sorgente originale in TypeScript è comunque verificabile direttamente dal repository GitHub alla commit corrispondente alla versione rilasciata.
