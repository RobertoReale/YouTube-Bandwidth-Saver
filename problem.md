# Riepilogo del Problema Sperimentato

L'utilizzo dell'estensione genera un'interferenza con YouTube che si manifesta principalmente con il blocco della riproduzione dei video. Ecco i punti chiave del problema riscontrato:

## 1. Avviso Anti-Adblock di YouTube
Quando l'estensione viene attivata nel browser in uso (assieme ad altre estensioni come uBlock Origin, Enhanced-h264ify, ecc.), YouTube mostra la schermata di blocco con il messaggio **"Ad blockers violate YouTube's Terms of Service"**. 
- Se l'estensione viene disattivata, il problema scompare.
- Il problema si verifica solo nel browser "Normale" dove l'utente è loggato; nella modalità **Incognito** (dove non c'è tracciamento dell'account), il blocco non si presenta, anche mantenendo le stesse estensioni attive.

## 2. Errore in Console (Effetto Collaterale)
In concomitanza con la comparsa della schermata di blocco di YouTube, si verificava un errore nella console del browser:
`Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.`

**Causa dell'errore:** L'apparizione dell'avviso anti-adblock (o l'intervento di altre estensioni) altera la struttura standard del player di YouTube. L'estensione cercava di inserire il proprio pulsante vicino a quello delle impostazioni (`.ytp-settings-button`), ma non trovando la struttura HTML attesa, andava in crash restituendo l'errore `NotFoundError`.

## 3. Risoluzione del Problema
È emerso che i sistemi anti-adblock di YouTube (attivi per gli account tracciati) rilevano come "comportamento anomalo o malevolo" i tentativi di alterare e manipolare le richieste di rete (tramite l'override di `window.fetch`, `XMLHttpRequest` e la manipolazione di `ytInitialPlayerResponse`).

Per aggirare la rilevazione senza perdere i benefici dell'estensione, sono state apportate le seguenti modifiche al progetto:
- **Rimozione degli Hook di Rete:** Sono stati disabilitati i moduli che intercettano e manipolano la risposta del player. Questo evita che l'estensione venga scambiata per un ad-blocker.
- **Transizione a Plan C:** L'estensione si affida ora esclusivamente al "Piano C" (`createQualityEnforcer`). Questo modulo non modifica le richieste di rete in modo sospetto, ma utilizza le API native del player YouTube per impostare in automatico e forzare la qualità al minimo indispensabile (144p).
- **Rimozione del Pulsante nel Player:** Il tasto `Bandwidth Saver` inserito direttamente nel player è stato rimosso per evitare crash di compatibilità quando il DOM viene modificato da altre estensioni o da avvisi. L'attivazione/disattivazione avviene ora solo tramite il popup dell'estensione.

Queste modifiche hanno ripristinato il corretto funzionamento dell'estensione sul browser normale senza far scattare i sistemi di protezione di YouTube.
