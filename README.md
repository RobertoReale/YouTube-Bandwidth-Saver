# YouTube Bandwidth Saver

Estensione browser MV3 che **riduce al minimo** lo stream video di YouTube per
risparmiare drasticamente banda, nascondendo il video sgranato dietro un'elegante interfaccia "Audio Only", e lasciando intatti l'audio e tutti i controlli nativi del player.

**Stato: Fase 2 (UX) completata. Release Ready.** 

## Come funziona

YouTube utilizza SABR (Server-Advised Bitrate) per negoziare dinamicamente le qualità video sul server. Qualunque tentativo di intercettare e cancellare le tracce video lato client comporta la rottura del player. 

Per aggirare questo vincolo in modo sicuro (Piano C), l'estensione **intercetta le API del player HTML5 all'avvio** forzando la qualità a `tiny` (144p). Il video sgranato viene poi nascosto da un overlay visivo. In questo modo:
1. I consumi video crollano (pochi decimi di Megabyte).
2. Il player è felice, non subisce interruzioni anomale e funziona tutto: seek, buffering, playlist e caricamento continuo.

## Cosa NON fa, per costruzione

- **Nessuna richiesta di rete propria.** Né watch page, né `base.js`, né HEAD di verifica.
- **Nessun `eval`, nessun codice remoto.** Non ricostruiamo gli URL e non decifriamo signature; lasciamo fare il grosso del lavoro a YouTube.
- **Nessuna telemetria sui server.** I contatori dei MB risparmiati e dei log sono salvati *solo in locale* (`storage.session` e `storage.local`). Nessun dato lascia il dispositivo.
- **Nessun download, nessun blocco pubblicità.** Fuori dallo scopo unico. (Raccomandiamo uBlock Origin Lite se si vogliono fermare le pubblicità video).

## Sviluppo

```bash
pnpm install
pnpm dev        # Chrome con HMR e hot reload
pnpm build      # build di produzione in .output/chrome-mv3
pnpm check      # lint + typecheck + test
pnpm test       # vitest run
pnpm zip        # genera i pacchetti pronti per lo store
```

### Caricare la build in Chrome

```
chrome://extensions → Modalità sviluppatore → Carica estensione non pacchettizzata
→ seleziona .output/chrome-mv3
```

## Uso e Interfaccia

- **Pulsante nel Player**: Integrato nei controlli di YouTube. Attiva/Disattiva in un click.
- **Popup UI**: Scegli tra "Sempre Attivo", "Per Scheda" o "Spento".
- **Overlay Grafico**: Copre il video a bassa qualità mostrando la miniatura o uno sfondo neutro.
- **`Alt+A`**: Scorciatoia da tastiera.

## Privacy

Nessun dato raccolto. L'estensione non fa richieste di rete e non trasmette
nulla a noi o a terzi. 
Permessi richiesti: solo `storage` per le tue impostazioni, e l'accesso host a `www.youtube.com` / `music.youtube.com` per iniettare l'interfaccia.
