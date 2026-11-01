# Brief di progetto — FPS di guerra moderna 2030 per Solana Seeker

Versione: 0.1 (solo fondamenta, nessun gameplay implementato) · Data: 28/10/2026 (ora di Roma, UTC+1)
Destinatario: Michele (owner). Documento in italiano; codice e commenti in inglese.

Legenda: **[CONFERMATO]** = deciso dall'owner · **[PROPOSTO]** = default nostro, modificabile · **[IN SOSPESO]** = serve una decisione dell'owner.

---

## 1. Riepilogo

- FPS realistico ambientato nel 2030, a obiettivi e a squadre, ispirato alle meccaniche (non ai contenuti) di un
  classico FPS a obiettivi rilasciato in GPLv3. Riferimento tecnico: `docs/et-reference.md`.
- Motore: Three.js + TypeScript (Vite), fisica Rapier (`@dimforge/rapier3d-compat`), APK Android firmato con
  gioco e asset inclusi nel pacchetto, per il telefono Solana Seeker.
- Due modalità: **offline contro bot** e **online** su Cloudflare (piano Free).
- **[CONFERMATO] Nessuna Free Play.** La promo OnlyFridge non si applica.
- **[CONFERMATO] Unico accesso: "Daily Pass"**, ottenuto con uno swap di 0,01 SOL nel token SWANGY, che poi resta
  trattenuto per 1 giorno (dettagli al § 9).

## 2. Nome e identità — [CONFERMATO dal proprietario, 28/10/2026]

- **Nome: SEEK & STRIKE** (sostituisce i titoli provvisori "Modern War 2030" e "Linea Zero 2030").
  Il nome vive in un'unica costante: `shared/src/config.ts` → `GAME_TITLE`. Da lì derivano schermata
  del titolo, titolo della pagina, nome dell'identità wallet (`WALLET_IDENTITY.name`, per Mobile Wallet
  Adapter quando il pass sarà implementato) e bozza della scheda per il dApp Store (`docs/store-listing.md`).
- **Motto: "Every Seeker is a soldier."** (in inglese in tutte le lingue; costante `GAME_TAGLINE`).
- **Logo [ARTE IN SOSPESO, prodotta separatamente dal proprietario]:** stencil militare nero; entrambe le
  iniziali "S"; la "&" disegnata come reticolo di un'ottica da fucile. Nel codice c'è solo uno spazio
  riservato (`GAME_LOGO_PATH`, oggi `null` → il menu mostra un logotipo testuale). File atteso, incluso nel
  pacchetto e mai caricato da remoto: `public/assets/brand/logo.webp` (+ icona 512 px per wallet/store).
- Restano da fare prima del rilascio: verifica del marchio (EUIPO/USPTO), disponibilità sul dApp Store e
  del dominio. L'App ID Android resta un segnaposto (`app.seekandstrike.PENDING`).

## 3. Trasposizione al 2030

### 3.1 Classi [PROPOSTO]

| Classe | Ruolo (equivalente nel riferimento) | Strumento 2030 (consuma la barra "carica") |
| --- | --- | --- |
| Assalto | potenza di fuoco (soldato) | lanciagranate da 40 mm, mitragliatrice leggera, drone FPV kamikaze a corto raggio |
| Medico | cura e rianimazione | kit trauma, autoiniettore (rianimazione), drone che lancia medikit |
| Geniere | costruzione, esplosivi e disinnesco | cariche da breccia, disinnesco, barricate rapide, jammer anti-drone |
| Ricognitore | fucile di precisione e infiltrazione (covert ops) | quadricottero da ricognizione (marca i nemici), sensori a terra, travestimento → "spoof IFF" |
| Supporto di fuoco (field ops) | munizioni e supporto | casse munizioni, tablet per drone d'attacco o mortaio guidato, radio |

Le barre di carica partono dai valori del riferimento: 20/45/30/30/40 s (`g_main.c:248-254`).

### 3.2 Armi [PROPOSTO]

Armi generiche, senza nomi commerciali. Fucile d'assalto 5,56 mm, carabina compatta, PDW 4,6 mm, LMG 5,56 mm,
DMR 7,62 mm, fucile anti-materiale 12,7 mm, pistola 9 mm, granate, lanciatore 40 mm.

### 3.3 Balistica realistica [PROPOSTO]

- Proiettili simulati (non hitscan): velocità alla volata, caduta per gravità (9,81 m/s²) e resistenza dell'aria
  con coefficiente G7 semplificato; integrazione a passo fisso a 60 Hz con sotto-passi per i proiettili veloci.
- Penetrazione per materiale (legno, cartongesso, lamiera, cemento): spessore massimo per calibro e perdita di energia.
- Zone colpite: testa, torso, arti; giubbotto ed elmetto come moltiplicatori.
- Online: il server valida i colpi con riavvolgimento lag-compensato (stessa idea di `g_antilag.c`), entro un limite
  di 200 ms.

### 3.4 Movimento, salute, ondate [PROPOSTO]

- Posture in piedi/accucciato/prono con le scale del riferimento (0,8/1,1/0,25/0,21), più inerzia e oscillazione
  dell'arma; stamina per lo scatto.
- Salute 100 (+10 per medico, massimo 125); a terra → rianimabile → limbo → respawn a ondate di 20–30 s.
- XP solo per la partita, assegnati per azioni di squadra (rianimare, costruire, rifornire, obiettivi).

## 4. Prima mappa [PROPOSTO]: "Porto di Ardesia" (nome provvisorio)

- Porto industriale sul Mediterraneo all'alba, circa 180 × 120 m. Gli attaccanti arrivano dal mare, i difensori
  stanno nel deposito container.
- Tre fasi:
  1. il geniere costruisce una rampa d'assalto;
  2. si fa breccia nel cancello del terminal con una carica (fuse 30 s, disinnescabile);
  3. si estraggono i dati da un server in sala controllo e si portano al punto di esfiltrazione.
- Grafo degli obiettivi dichiarativo in JSON (niente linguaggio di script).
- La scena di test attuale (`client/src/render/testEnvironment.ts`) è un grey-box di container, barriere e muro con varco.

## 5. Modalità di gioco

### 5.1 Offline contro bot [PROPOSTO]

- Bot a macchina a stati/utilità ispirati ai nodi AI del riferimento (`botai/ai_dmnet_mp.h:72-91`): cerca obiettivo,
  combatti, insegui o ritirati, rianima, costruisci o disinnesca, difendi, rifornisci. Si muovono su navmesh.
- Simulazione locale identica a quella del server (codice in `/shared`).
- **[IN SOSPESO]** Senza Free Play, **anche la modalità offline sta dietro il Daily Pass**, a meno che l'owner non
  definisca una parte gratuita (per esempio tutorial o poligono di tiro).

### 5.2 Online su Cloudflare Free [PROPOSTO]

Architettura:
- Worker come ingresso: `/health` e `/room/<id>/ws`.
- **Durable Object** per stanza (`MatchRoom`) con backend SQLite (sul piano Free è l'unico disponibile).
- Server autoritativo: valida input, movimento, colpi e obiettivi. Il client invia solo input.
- La lobby/matchmaking usa la **WebSocket Hibernation** (`ctx.acceptWebSocket`, `setWebSocketAutoResponse` per i
  ping, che non costano). Il DO di partita invece resta attivo **solo durante la partita**, perché un tick loop
  impedisce l'ibernazione.
- Durante la partita il tick usa `setInterval`. Non usiamo un alarm per ogni tick, perché gli alarm contano come
  scritture.

Parametri (`shared/src/constants.ts`):
- tick server 20 Hz (come `sv_fps` 20 del riferimento, `server/sv_init.c:791`)
- snapshot 15 Hz
- input client raggruppati a 10 Hz
- massimo 8 giocatori per stanza
- partita di 15 minuti al massimo
- 20 s di tolleranza per la riconnessione

Limiti Free (letti il 28/10/2026):
- Workers: 100.000 richieste/giorno e 10 ms di CPU per richiesta.
- Durable Objects: 100.000 richieste/giorno; i messaggi WebSocket in entrata sono conteggiati 20:1, quelli in
  uscita sono gratuiti; 13.000 GB-s/giorno (≈ 28,9 ore-DO a 128 MB).
- Superato il limite, le operazioni falliscono. Il contatore si azzera alle 00:00 UTC (01:00 ora di Roma).

Fonti:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/

Budget stimato:
- 10 msg/s in entrata per giocatore → 36.000 messaggi/ora → circa 1.800 richieste conteggiate per giocatore-ora.
- Questo dà **circa 55 giocatore-ore al giorno** (per esempio 7 partite piene da 15 minuti con 8 giocatori sono
  circa 14 giocatore-ore).
- A quote esaurite il client mostra "Capacità online esaurita per oggi" e propone la modalità offline.
- In caso di crescita si passa al piano Workers Paid (decisione dell'owner).

Stato attuale:
- `server/src/index.ts` contiene solo handshake, ping e "stanza piena", senza gameplay.
- `server/wrangler.toml` è un segnaposto **mai deployato** (`workers_dev = false`).
- Il dry-run (`npm run server:check`) passa.

## 6. Fisica [PROPOSTO]

- `@dimforge/rapier3d-compat` 0.21.0 (WASM incluso nel bundle), passo fisso 60 Hz con recupero limitato
  (`shared/src/fixedStep.ts`, testato).
- Controller personaggio cinematico; proiettili con raycast a segmenti per ogni sotto-passo.
- Ragdoll con corpi rigidi e giunti sferici o a cerniera, attivati alla morte, al massimo 4 contemporaneamente su Seeker.
- Fisica deterministica lato server per gli obiettivi; i ragdoll sono solo cosmetici lato client.

## 7. Pipeline degli asset [PROPOSTO]

Ogni asset viene registrato in `ASSETS_LICENSES.md` prima di essere incluso.
- **Poly Haven** (CC0): HDRI, texture, props.
- **ambientCG** (CC0): materiali PBR.
- **Quaternius / Kenney** (CC0): props e armi low-poly da rifinire.
- **MakeHuman** (esportazioni CC0) oppure **Ara 3D Gen** per i soldati, verificando i termini dell'account al momento
  della generazione.
- **Mixamo**: le animazioni si possono usare nei giochi, ma i file grezzi non si possono ridistribuire. Si possono
  includere solo dentro l'APK, e i termini Adobe vanno ricontrollati.
- Conversione in glTF/GLB con compressione meshopt/KTX2; texture colore in sRGB.

## 8. Prestazioni Seeker e controlli touch

### Budget prestazioni [CONFERMATO dalle regole della skill]

- DPR massimo 1,5; una sola luce con ombra da 1024; ambiente PMREM.
- Quality governor già integrato: finestre di 3 s; scende sotto 50 FPS; sale dopo due finestre sopra 58; 30 s di pausa.
- **Gate di rilascio: almeno 50 FPS misurati su un Seeker fisico.**
- Bundle attuale: circa 4,9 MB di JS (1,8 MB gzip), dovuti soprattutto al WASM di Rapier incluso. Accettabile in un
  APK; si potrà dividere in seguito.

### Controlli touch [PROPOSTO]

- Stick virtuale a sinistra; a destra si trascina per mirare (sensibilità e curva regolabili).
- Pulsanti: fuoco, mira, ricarica, salto, postura, granata, abilità.
- Fuoco anche dal lato sinistro come opzione; vibrazione leggera; layout modificabile.

### Host Android [IN SOSPESO]

- Capacitor è ora solo un segnaposto e non è installato.
- La skill richiede un ponte JS minimo (`addWebMessageListener`, `WebViewAssetLoader` su
  `appassets.androidplatform.net`), mentre Capacitor espone un ponte ampio.
- **Proposta:** host Kotlin personalizzato con WebView. In alternativa Capacitor con plugin ridotti al minimo.
- Nessuna firma in questa fase.

## 9. Daily Pass (accesso) e mercato in-game

### 9.1 Decisioni dell'owner [CONFERMATO]

- Token (mint): `82cE5gmmJ9hH2F1o1CtDrQbaUaR6ZW4mtRZVNHCJpump`.
- **Un solo livello: "Daily Pass", al prezzo di 0,01 SOL.**
- L'app fa lo swap di 0,01 SOL nel token sul suo pool pump.fun e trattiene i token ricevuti per 1 giorno nel
  programma Fridge `9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6`.
- Mercato in-game: **sì, ma limitato a questo flusso di acquisto del pass**, secondo `in-game-market.md` e `season-pass.md`.
- Obiettivo dell'owner: il minimo attrito possibile.

### 9.2 Verifica on-chain (solo lettura) — 28/10/2026 08:25–08:28 ora di Roma

Tutte le verifiche sono letture sull'RPC pubblico `https://api.mainnet-beta.solana.com`. Nessuna firma e nessun invio.

| Verifica | Risultato | Evidenza |
| --- | --- | --- |
| Programma del token | **Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`): compatibile con `create_lock` | `getAccountInfo` jsonParsed, slot 462390973 |
| Decimali | **6** | idem |
| Supply | 1.000.000.000 token (1e15 unità raw) | idem |
| Mint authority / freeze authority | **nessuna / nessuna** | idem |
| Estensioni | solo `metadataPointer` e `tokenMetadata` (nome e simbolo "SWANGY", update authority nulla). **Nessuna** TransferFee né TransferHook → supera i controlli della skill | idem, dimensione account 410 byte |
| Stato pump.fun | **ancora sulla bonding curve, non migrato.** Curva `FQTx4iCwahhdtVyZNPRGL86vbcJuVbyyhg8QdCsg78Rs` (owner Pump `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`), `complete = false` | slot 462391175 |
| Valuta di quotazione della curva | **non SOL ma PASTA** (`39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump`) | campo `quoteMint` della curva |
| Pool PumpSwap SWANGY/wSOL o SWANGY/PASTA | **inesistenti** | PDA canonici non trovati |
| PASTA | Token-2022, 6 decimali, nessuna authority; curva completata; pool PumpSwap PASTA/wSOL `5o5JBdWZd3zKE3JC8Tb81D3bph7bwxftvwLLRoZ1EqL5` | getAccountInfo |
| Programmi Pump, PumpSwap (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) e Fridge | eseguibili e **aggiornabili** (BPFLoaderUpgradeable) | getAccountInfo |
| Verifica build Fridge | `is_verified: true`, hash on-chain `0043d6da…237e`, repo `mikeminer/devfridge` commit `292645a`, ultima verifica 25/08/2026 | https://verify.osec.io/status/9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6 |
| Commissioni curva Pump (FeeConfig) | protocollo 95 bps + creator 30 bps, LP 0 | `fetchFeeConfig` (pump-sdk 4.3.1) |

**Percorso dello swap (risultato chiave):** SOL → (pool PumpSwap PASTA/wSOL) → PASTA → (bonding curve) → SWANGY.
- Sono 2 hop con `multi_hop_swap` (exact-in, `minOut` finale).
- Il giocatore **non detiene mai PASTA**.
- Quando SWANGY migrerà, il percorso cambierà: l'app deve rilevarlo a ogni quotazione (`resolveMultiHopRoute`).

### 9.3 Simulazione (non firmata, `sigVerify:false`) — 28/10/2026 08:27 ora di Roma

Svolta con un account pubblico di sola simulazione (`5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`).
Script: `/tmp/solcheck/sim.cjs`, fuori dal progetto.

| Caso | Dimensione serializzata (limite 1232 byte) | Esito | CU consumate |
| --- | --- | --- | --- |
| Solo swap (2 hop, 0,01 SOL) | 1120 | ok | 161.216 |
| **Swap + `create_lock` in un'unica tx**, completa | **1259 → troppo grande** | rifiutata dall'RPC | — |
| Swap + `create_lock`, senza la creazione dell'ATA buyback (già esistente on-chain) | 1217 | — | — |
| Come sopra + `SetComputeUnitPrice` | **1229 (margine 3 byte)** | **ok** | **210.762** |
| Solo `create_lock` (controllo, il wallet non ha SWANGY) | 475 | errore atteso 3012 `AccountNotInitialized` | 4.800 |

Altri risultati della simulazione:
- Uscita simulata: 1.447.854,571993 SWANGY. `minOut` al 2%: **1.418.897,480553 SWANGY** (raw 1418897480553).
- La simulazione combinata crea un account Lock valido: 105 byte, discriminatore `08ff24cad2163989`,
  amount = minOut, `unlockAt − createdAt` = 86.399 s, rent 1.183.640 lamport.
- La differenza tra quanto ricevuto e minOut (circa il 2% nel caso atteso) **resta nel wallet del giocatore**.
- Rent misurato dal vivo:
  - PDA del deposito (105 byte): 1.183.640 lamport
  - ATA Token-2022 (170 byte): 1.513.840 lamport
  - l'ATA wSOL temporaneo viene chiuso nella stessa tx e il suo rent rientra
- Priority fee recenti: mediana 0.

### 9.4 Una transazione o due — valutazione

**A) Una sola transazione (consigliata [PROPOSTO]).** Contenuto: ComputeBudget, wrap SOL, ATA idempotenti, `multi_hop_swap`, chiusura wSOL, `create_lock(amount = minOut)`.
- Pro:
  - **una sola approvazione** nel wallet;
  - **atomica**: se fallisce qualcosa non succede nulla, e il giocatore non resta con token comprati senza pass.
  - 210k CU, ampiamente sotto 400k.
- Contro:
  - Il margine è **molto stretto**: 3 byte con priority fee, 15 senza. Funziona solo se l'ATA del destinatario
    buyback esiste già (oggi sì).
  - Un wallet che aggiunge istruzioni proprie (alcuni wallet aggiungono guardie o priority fee) farebbe superare
    il limite.
  - **Devia dalla regola della skill** per il Season Pass ("esattamente un `SetComputeUnitLimit` + un
    `create_lock`, nessun'altra istruzione, nessuna LUT"). Serve un **validatore nativo combinato** che unisca gli
    invarianti di BuyTxValidator (circa 20 casi di manomissione) e quelli del validatore del pass, con
    `create_lock.amount == minAmountOut` dello swap, stesso mint, stesso ATA di destinazione ed end time dentro la
    finestra della skill (now + 86400 − 1800 … + 300).
  - **[IN SOSPESO] Serve l'approvazione esplicita dell'owner per questa deviazione.**
- Mitigazioni del margine:
  - **(i)** niente `SetComputeUnitPrice`, quindi margine di 15 byte;
  - **(ii)** scegliere un destinatario buyback con ATA già esistente;
  - **(iii)** opzione: una Address Lookup Table dell'owner per gli account statici (programmi, config globali, pool),
    che libera centinaia di byte. Richiede la creazione on-chain da parte dell'owner, e il validatore deve fissare
    indirizzo e contenuto esatti della tabella (la skill del mercato lo consente; quella del pass vieta le LUT,
    quindi è un'altra deviazione).

**B) Due transazioni (fallback).** tx1 = swap (1120 byte), tx2 = `create_lock` (475 byte).
- Con MWA si possono inviare insieme in un'unica richiesta `signAndSendTransactions` (una schermata nel wallet),
  ma l'ordine e l'atomicità **non sono garantiti**. tx2 deve comunque usare minOut, perché viene firmata prima che
  tx1 venga eseguita.
- Se tx1 va a buon fine e tx2 fallisce, il giocatore ha SWANGY ma nessun pass. Serve lo stato di recupero
  "Token ricevuti, pass non ancora attivo → Attiva" (solo il lock), che è un secondo passaggio.
- Pro: rispetta letteralmente la regola "una tx = un `create_lock`" del pass. Contro: più attrito e stati intermedi.

**Vincoli MWA (validi in entrambi i casi):**
- uso `signAndSendTransactions`; `signTransactions` solo se il wallet risponde -32601;
- il wallet deve supportare le tx v0;
- il limite di 1232 byte resta invariato;
- un timeout significa **esito sconosciuto e nessuna nuova firma**;
- record pendente durevole `awaiting-wallet → submitted/unknown → confirmed/declined`, con 10 minuti di
  riconciliazione attiva;
- chiamate single-flight con activity RESUMED.

**Raccomandazione:** A, con il fallback B automatico solo se la tx combinata non entra nei limiti (route
cambiata, ATA buyback mancante) o il wallet la rifiuta per dimensione. B è presentato come due passaggi chiari.

### 9.5 Regola di validità del pass (risolve il conflitto con la regola "importo intero esatto")

Il problema: la skill definisce i livelli come `{id, label, days, amountRaw}` con un importo **esatto** di token.
Qui l'owner fissa il **prezzo in SOL**, quindi la quantità di SWANGY cambia con il prezzo. Un `amountRaw` fisso:
- se troppo alto, diventa irraggiungibile quando il token sale;
- se troppo basso, permette pass "a costo zero" con una manciata di token.

**Proposta [PROPOSTO] — regola verificabile on-chain.** Il pass è valido se esiste **almeno un singolo deposito**
(mai sommare depositi diversi) con tutte queste condizioni:
1. stesso wallet e mint SWANGY;
2. `unlockAt > now`;
3. durata originale `unlockAt − createdAt ≥ 86.400 − 3.600 s`;
4. una delle due:
   - **(a) soglia:** `amount ≥ floorRaw`, una soglia anti-spam bassa fissata dall'owner (proposta: 100.000 SWANGY =
     `100000000000` raw, circa il 7% di quanto si ottiene oggi con 0,01 SOL; da rivedere a ogni release); oppure
   - **(b) ricevuta d'acquisto:** la transazione che ha creato quel PDA è firmata dal wallet e contiene
     `multi_hop_swap` con input ≥ 10.000.000 lamport (0,01 SOL) verso SWANGY, e `create_lock` per quel PDA con
     amount = minOut. La storia di un PDA creato da meno di 1 giorno è disponibile sugli RPC normali.

Come spiegarlo al giocatore: "Il pass vale finché i token del tuo ultimo acquisto restano trattenuti, per 1 giorno."

Compatibilità con la skill:
- il livello resta `{id:'daily', days:1, amountRaw: floorRaw}` con BigInt esatto, quindi la parte (a) è
  esattamente il valutatore della skill con `amount ≥ amountRaw`;
- la (b) è un valutatore aggiuntivo, documentato come deviazione;
- prova con `maxAgeSeconds` 90;
- online, il server rivaluta con la propria lettura RPC.

Prima dell'approvazione l'app controlla che `minOut ≥ floorRaw`. Se 0,01 SOL non basta più, mostra un messaggio
chiaro e non procede (la ricevuta (b) resta valida per gli acquisti già fatti).

### 9.5-bis Buffer di acquisto (chiarimento dell'owner, 28/10/2026 08:33)

**Requisito [CONFERMATO]:** l'app compra un po' **più** dell'equivalente di 0,01 SOL. Il margine copre le
commissioni e i movimenti di prezzo, così la quantità trattenuta raggiunge sempre la soglia del pass.

**Politica proposta [PROPOSTO]** (tutti i calcoli in BigInt sui lamport e sulle unità raw):

1. **Importo nominale** `N` = 10.000.000 lamport (0,01 SOL).
2. **Obiettivo token** `T` = uscita simulata **netta** per `N`, da una quotazione fresca (aggiornata ogni 5 s).
   - Le commissioni pump.fun (protocollo e creator) e PumpSwap sono già dentro la simulazione.
   - Un'eventuale transfer fee Token-2022 andrebbe sottratta, ma qui è **assente** (verificato): un mint con
     TransferFee verrebbe comunque rifiutato.
3. **Importo d'acquisto** `A`:
   - è il minimo per cui `floor(sim(A) × (10000 − slippageBps) / 10000) ≥ T`;
   - si parte da `ceil(N × 10000 / (10000 − slippageBps))` e si verifica con 1–2 simulazioni;
   - poi si aggiunge un margine di sicurezza `bufferSafetyBps` (default **25 bps**, configurabile) per l'impatto di
     prezzo e l'arrotondamento;
   - `A` si arrotonda per eccesso ai 1.000 lamport.
4. **Tetto:** se `A > N × (10000 + maxBufferBps) / 10000` (default `maxBufferBps` = **600**, cioè al massimo
   0,0106 SOL), l'app si ferma con un messaggio chiaro ("Il mercato si muove troppo, riprova tra poco") e non
   chiede alcuna firma.
5. **Quantità trattenuta** `L` = `minAmountOut` della tx finale.
   - Per costruzione `L ≥ T`.
   - Se il prezzo peggiora oltre lo slippage, la tx fallisce in blocco: niente token comprati e nessun pass parziale.
   - L'eventuale eccedenza oltre `L` resta nel wallet.
6. Le fee di rete e priorità e il rent sono pagati in SOL **a parte**. Non riducono i token ricevuti, quindi non
   fanno parte del buffer dello swap, ma sono inclusi nel totale mostrato.
7. Il validatore nativo vincola:
   - `amountIn == A` mostrato in revisione, con `N ≤ A ≤ N × (1 + maxBufferBps)`;
   - `create_lock.amount == minAmountOut`;
   - `minAmountOut ≥ T` della quotazione approvata;
   - una nuova quotazione con `A` diverso aggiorna la revisione prima dell'approvazione.

**Misura reale** (simulazione read-only, 28/10/2026 08:33 ora di Roma, `/tmp/solcheck/buffer.cjs`).
`T` = 1.447.854,571993 SWANGY per 0,01 SOL.

| Slippage | `A` minimo (senza margine di sicurezza) | Buffer | minOut / T |
| --- | --- | --- | --- |
| 1% | 10.101.562 lamport | +1,016% | 1,00004 |
| **2% (default)** | **10.205.078 lamport** | **+2,051%** | 1,00006 |
| 5% | 10.527.343 lamport | +5,273% | 1,00001 |

Con il default (2% + 25 bps) si ottiene **A ≈ 10.231.000 lamport = 0,010231 SOL**. L'impatto di prezzo è
trascurabile alla liquidità attuale. Il buffer non cambia la dimensione della tx (1229 byte): cambiano solo i valori.

**Totale esatto mostrato prima dell'approvazione.** Lo swap è exact-in, quindi il totale è un numero preciso e
non una stima. Valori di oggi:

| Voce | Prima volta | Acquisti successivi |
| --- | --- | --- |
| Swap (A, buffer incluso) | 0,010231000 | 0,010231000 |
| Rent PDA del pass | 0,001183640 | 0,001183640 |
| Rent vault Token-2022 | 0,001513840 | 0,001513840 |
| Rent ATA SWANGY del giocatore | 0,001513840 | — |
| Fee di rete (base 5.000 lamport + priority, oggi 0) | 0,000005000 | 0,000005000 |
| **Totale SOL** | **≈ 0,014447 SOL** | **≈ 0,012934 SOL** |

- L'ATA wSOL temporaneo viene aperto e chiuso nella stessa tx: il rent rientra, ma il saldo deve coprirlo durante
  la tx (circa 0,0015 SOL di riserva).
- La schermata mostra:
  - il totale in SOL con tutte le cifre, in lamport nei Dettagli;
  - la riga "include un margine del X% per variazioni di prezzo e commissioni";
  - i SWANGY trattenuti (`L`) e quelli attesi in eccesso, che restano nel wallet;
  - l'ora di fine in ora locale e UTC.
- Se il saldo SOL non basta per il totale più la riserva, il pulsante resta disattivato con una frase che lo spiega.

**Soglia di verifica, allineata al buffer [PROPOSTO].** Un verificatore successivo, per esempio il server online
il giorno dopo, non conosce il prezzo del momento dell'acquisto. Per questo la soglia **non** può essere "T di
quel momento". Si usa la regola del § 9.5, ora precisata:
- **(b) ricevuta, via principale:** la tx che ha creato il PDA è firmata dal wallet e contiene:
  - `multi_hop_swap` SOL→PASTA→SWANGY con **amountIn ≥ N** (vale sempre grazie al buffer);
  - `create_lock` per quel PDA con **amount == minAmountOut** dello swap;
  - in più, dai `postTokenBalances` della tx, SWANGY ricevuti ≥ amount.
  In pratica "hai speso almeno 0,01 SOL e tutto il minimo garantito è trattenuto". Questa condizione è
  verificabile on-chain ed è indipendente dal prezzo.
- **(a) soglia statica di riserva:** `amount ≥ floorRaw`. La proposta è 100.000 SWANGY (circa 7% di T oggi),
  da usare solo se la storia della tx non è leggibile dall'RPC.
  - Prima della firma l'app verifica `L ≥ floorRaw`; se non è così, non procede.
  - La soglia resta in ogni caso molto sotto `L`, quindi un aumento del prezzo di circa 14 volte non blocca gli
    acquisti.
- Restano valide: durata originale ≥ 86.400 − 3.600 s, `unlockAt > now`, un singolo deposito (mai somme) e prova
  con età ≤ 90 s.

### 9.6 Cosa mostrare prima dell'approvazione (revisione)

- Input **A** (0,01 SOL + buffer, § 9.5-bis), con il totale SOL esatto; SWANGY attesi; **minimo garantito** (slippage predefinito 2%, opzioni 1/2/5%; quotazione
  aggiornata ogni 5 s e ri-simulazione della tx finale); impatto sul prezzo; percorso via PASTA (solo nei Dettagli).
- Quantità trattenuta = minimo garantito; l'eventuale eccedenza resta nel wallet.
- Fine del pass in **ora locale e UTC**; i token non sono utilizzabili fino alla fine.
- Commissioni dello swap: protocollo e creator pump.fun (oggi 0,95% + 0,30% sull'hop della curva, più la
  commissione del pool PumpSwap sull'hop PASTA), già incluse nella quotazione.
- Costi di rete e rent, letti dal vivo. Valori di oggi:
  - fee base 5.000 lamport;
  - rent PDA 0,00118364 SOL;
  - rent vault 0,00151384 SOL;
  - **prima volta**: rent ATA SWANGY del giocatore 0,00151384 SOL;
  - riserva SOL per la tx.
  - Totale netto con il buffer del § 9.5-bis: prima volta ≈ **0,014447 SOL**, poi ≈ **0,012934 SOL**
    (senza buffer sarebbero 0,01421 / 0,01270).
  - **[IN SOSPESO]** Da verificare nell'IDL fissato se il rent di PDA e vault rientra alla fine del pass.
- **Dettagli** (sezione espandibile):
  - indirizzo del programma `9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6`;
  - mint completo con pulsante Copia;
  - politica di verifica, commissioni e rent;
  - la frase obbligatoria: *"When your pass ends and your SWANGY leaves the program, a 2% fee buys and burns PASTA."*
    (versione italiana da approvare: *"Quando il tuo pass termina e i tuoi SWANGY escono dal programma, una
    commissione del 2% compra e brucia PASTA."*)
- Rischio da indicare: SWANGY non è ancora migrato. Il buyback del 2% richiede un percorso eseguibile, quindi alla
  scadenza il rilascio potrebbe non essere immediato. Il pass non fissa un valore e il token può scendere.
- Testi per il giocatore: niente lock/unlock/Fridge/PASTA fuori dai Dettagli; nelle schermate del pass niente
  formule tipo "paga" o "prezzo". Esempio: **"Ottieni il Daily Pass — scambia 0,01 SOL in SWANGY, trattenuti per
  1 giorno"**. Nessuna promessa di guadagni.
- **[IN SOSPESO]** Il "prezzo 0,01 SOL" richiesto dall'owner va formulato senza la parola "prezzo".

### 9.7 Flusso (ordine della skill)

1. wallet autenticato;
2. verifica di mint, ATA, saldo SOL (A + rent + fee + riserva wSOL), rilevamento del percorso e calcolo del buffer;
3. revisione;
4. tx nuova (blockhash fresco, `unlock_at` calcolato al momento della firma, primo `lock_id` libero tra 1 e 64);
5. simulazione;
6. **validatore nativo Kotlin** (combinato);
7. record pendente durevole;
8. passaggio al wallet (MWA);
9. riconciliazione;
10. nuova lettura on-chain del pass.

Errori del programma 6000/6001/6002/6003/6004/6008 tradotti in frasi chiare. IDL Fridge, Pump e PumpSwap fissati
per hash. Il deployment Fridge va ricontrollato prima di ogni release, perché il programma è aggiornabile (vedi
verifica osec, commit `292645a`, rispetto all'IDL fissato dalla skill).

**Implementato in Fase 3** (28/10/2026): flusso completo, interfaccia it/en, proxy RPC (non pubblicato), test e simulazioni. Stato, risultati e verifiche per Michele: `docs/daily-pass-test-plan.md`.

## 10. Card sponsor Scan (menu principale)

- **[CONFERMATO] Deviazione esplicita dell'owner da `free-play-sponsors.md`:** la card "token sponsorizzato / YOUR AD
  HERE" compare **solo nel menu principale/di avvio**. Mai in gameplay, nelle schermate del Daily Pass (gate e
  revisione), al checkout o in partita.
- Si applicano le altre regole della guida:
  - lettura nativa da `https://scan.devfridge.cool/api/feed/boosted` (upstream fisso);
  - validazione dei dati;
  - una sola selezione stabile per visita;
  - link costruiti localmente `https://scan.devfridge.cool/t/<mint>`; card vuota → `https://scan.devfridge.cool/#feature`;
  - apertura solo con un tocco esplicito;
  - la card **non concede mai l'accesso**.
- Il link "Feature" coincide con questa card. Per ora è solo annotato qui, non implementato.

## 11. Licenze

- Progetto **GPL-3.0-or-later** (`COPYING`, testo GPLv3 ufficiale).
- Se si porta anche una sola riga di codice del gioco di riferimento, il nostro diventa un'opera derivata. In quel
  caso vanno incluse **testualmente** le "additional terms" del suo `COPYING.txt` (niente licenza sui marchi,
  esclusioni di garanzia) e mantenute le sue note.
- Mai usare titolo, fazioni, mappe, loghi, suoni o marchi originali.
- Gli asset seguono le proprie licenze (`ASSETS_LICENSES.md`). La GPL obbliga a fornire il sorgente corrispondente
  dell'APK distribuito.

## 12. Riepilogo decisioni

### Confermate
- Three.js + TS, Rapier, APK Seeker con asset inclusi; gate di 50 FPS; nessuna Free Play; card Scan solo nel menu
  principale; Daily Pass unico a 0,01 SOL con SWANGY trattenuto per 1 giorno nel Fridge; acquisto con buffer sopra 0,01 SOL; mercato in-game limitato al pass.
- **[28/10] Nome: SEEK & STRIKE**, motto "Every Seeker is a soldier.", logo in arrivo dal proprietario (§ 2).
- **[28/10] Transazione unica swap + lock approvata.** Riserva: due transazioni nella stessa richiesta MWA, con stato
  di recupero "token ricevuti, pass non attivo → Attiva".
- **[28/10] Tutto il gioco, offline contro bot incluso, è dietro al Daily Pass.** Un flag DEV
  (`__DEV_PASS_BYPASS__`, solo `npm run dev` e `npm run build:dev`) salta il gate per lo sviluppo; nella build di
  rilascio è la costante `false` e il codice viene eliminato (controllo: `npm run check:release`).

### Default in uso (configurabili in `shared/src/config.ts`, `PENDING_DEFAULTS`; da confermare)
- App ID `app.seekandstrike.PENDING`; dominio `PENDING.example.invalid`; lingue it + en; gore "low" (niente sangue);
  `floorRaw` 100.000 SWANGY; slippage 2% (buffer +25 bps, tetto 600 bps); host Capacitor; offerta di rimborso del
  rent alla scadenza del pass (da verificare nell'IDL).

### Ancora in sospeso
1. Conferma dei default qui sopra.
2. Testo "prezzo" senza la parola prezzo; traduzione della frase sul 2%.
3. Passaggio a Cloudflare Paid oltre le quote Free.
4. Arte del logo e icona (§ 2); verifica marchio e dominio.
