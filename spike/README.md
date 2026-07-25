# Spike fase 0 — protocollo di verifica

Codice usa-e-getta (PLAN.md §14). Serve solo a rispondere a quattro domande.
Non è la base della fase 1.

## Caricamento

1. Chrome/Edge → `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → seleziona questa cartella `spike/`
3. Verifica che non ci siano errori nella card dell'estensione

## Le quattro domande

Per ognuna: apri DevTools **prima** di navigare (F12), tieni aperti Console e
Network, e usa `youtube.com/watch?v=...` di un video normale (non live, non
Shorts, non a pagamento) di almeno 5 minuti.

### D1 — Il player parte e riproduce l'audio? ⚠️ è la domanda che decide tutto

- In Console deve comparire `[spike] hook installati` e poi
  `[spike] property: -N video, ... audio tenute`.
  - Se **manca** `property:` → l'hook ha perso la corsa contro lo script inline:
    problema di timing, non di architettura. Segnalalo separatamente.
- Il video parte? Si sente l'audio? L'area video sarà nera/vuota: è atteso.
- In Console esegui due volte a ~5 s di distanza:
  `document.querySelector('video').currentTime`
  → il numero deve **avanzare**.
- Guarda `document.querySelector('video').error` → deve essere `null`.
- Cerca in Console errori del player: banner "Si è verificato un errore",
  codici tipo `MEDIA_ERR_*`, `ERROR_TYPE`, loop di ricaricamento.

**Risposta:** ✅ l'audio riproduce / ❌ il player va in errore o non parte
(in questo caso: copiami gli errori di Console e il testo esatto del banner).

### D2 — Il traffico video è davvero zero?

- Network → filtro `googlevideo.com`
- Guarda la query string delle richieste: ogni richiesta di segmento contiene
  `mime=video%2Fmp4` / `mime=video%2Fwebm` oppure `mime=audio%2F...`
- **Criterio:** dopo 60 s di riproduzione, zero richieste con `mime=video%2F*`
- Confronto utile: stesso video con l'estensione disattivata (basta il toggle
  in `chrome://extensions`) — lì le richieste `mime=video/*` devono esserci

**Risposta:** ✅ zero richieste video / ❌ quante e verso quale `mime=`

### D3 — Seek, pausa, playlist funzionano?

- Trascina la barra di avanzamento avanti e indietro: l'audio riprende dal
  punto giusto senza bloccarsi?
- Pausa/riprendi, cambia volume, cambia velocità (0.5×, 2×)
- Apri una playlist e verifica il passaggio automatico al brano successivo
- La barra di avanzamento mostra la posizione corretta e il buffer?

**Risposta:** ✅ tutto nativo / ❌ cosa si rompe

### D4 — La navigazione SPA funziona?

- Dalla pagina video, clicca su un **video correlato** (senza ricaricare)
- In Console deve comparire una riga `[spike] fetch: ...` **oppure**
  `[spike] xhr: ...` per il nuovo video
- Il nuovo video parte in audio-only? Il traffico resta senza `mime=video/*`?
- Poi: `window.__ytAudioOnlySpike` in Console → riportami l'oggetto
  (`{property, fetch, xhr, skipped}`), dice quale dei tre hook ha lavorato

**Risposta:** ✅ / ❌ + il contenuto di `__ytAudioOnlySpike`

## Controlli di sicurezza (fail-open)

Cinque minuti, ma valgono molto:

- **Live stream**: apri una diretta → in Console deve comparire
  `[spike] ... SALTATO: live-stream` e il video deve funzionare **normalmente,
  con video**. Se una diretta si rompe, il fail-open non tiene.
- **Home page e ricerca**: naviga, scorri, cerca. Le miniature caricano? La
  pagina funziona? (verifica che il wrapper di `fetch` non abbia rotto altro)
- **Shorts**: aprine uno e riporta cosa accade — è un caso a parte, mi serve
  solo il dato.

## Cosa mandarmi

1. Le quattro risposte ✅/❌
2. Il dump di `window.__ytAudioOnlySpike`
3. Qualunque errore di Console, copiato per intero
4. Browser e versione (`chrome://version`)
