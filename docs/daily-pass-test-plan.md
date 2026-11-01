# Daily Pass — piano di test e stato (Fase 3)

Stato al 28/10/2026. Tutto ciò che segue è stato verificato **senza firme, senza invii e senza chiavi**:
letture RPC su mainnet, `simulateTransaction` con `sigVerify: false` e un wallet finto (MockAdapter) che
non possiede alcuna chiave. La verifica reale end-to-end la fa **Michele firmando sul suo Seeker**.

## 1. Cosa fa il Daily Pass

1. Connetti il wallet (MWA su Android/Seeker; Wallet Standard su desktop, solo sviluppo).
2. Il gioco legge i pass del wallet (record Fridge `9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6`, mint SWANGY).
3. Offerta: «Ottieni il Daily Pass — scambia 0,01 SOL in SWANGY, trattenuti per 1 giorno».
4. Controllo saldo e mercato: quota SOL→PASTA (pool PumpSwap `5o5JBdWZ…EqL5`)→SWANGY (curva
   `FQTx4iCw…78Rs`) calcolata dagli account on-chain, buffer = tolleranza scelta (1/2/5%, predefinita 2%)
   + 25 bps di sicurezza; se l'ingresso necessario supera 0,01 SOL × 1,06 → «il mercato si sta muovendo troppo».
5. Schermata di controllo: totale esatto in SOL (9 decimali), minimo garantito di SWANGY, fine del pass in ora
   locale e UTC, «include un margine del X%», dettaglio del totale, età della quota.
6. Una sola richiesta al wallet. Di norma **una transazione** (swap + `create_lock`); se non entra in 1232 byte,
   **due transazioni nella stessa richiesta** (swap, poi blocco), con recupero «Attiva» se arriva solo lo scambio.
7. Conferma sulla rete → pass attivo con conto alla rovescia, rinnovo («Aggiungi un altro giorno»).
8. A fine pass: elenco pass terminati e «Riporta nel wallet» (SWANGY + depositi di rete restituiti).
9. Errori gestiti: 10 esiti del wallet, errori Fridge 6000–6014, slippage, saldo insufficiente, blockhash
   scaduto, rete/RPC non raggiungibile, archivio locale, limite di 64 pass.
10. Il pulsante Gioca è attivo solo con pass attivo; il pass viene ricontrollato a Gioca e a ogni nuova partita
    (una partita in corso non viene mai interrotta) e quando il gioco torna in primo piano.

## 2. Controlli automatici (tutti verdi)

| Controllo | Comando | Esito |
|---|---|---|
| Tipi | `npm run typecheck` | OK |
| Test unitari | `npm test` | 132/132 (14 file) |
| Build release | `npm run build` | OK |
| Nessuna traccia DEV in release | `npm run check:release` | «no DEV bypass traces» |
| Build DEV | `npm run build:dev` | OK |
| Worker (solo dry-run) | `npm run server:check` | OK, **nessun deploy** |
| Testi giocatore | `check-player-copy.mjs --scope pass` / `--scope details` | 0 risultati |
| Segreti | `check-no-secrets.py` | 0 risultati |

## 3. Simulazioni mainnet in sola lettura (`npm run sim`, 7/7)

Risultati completi: `docs/sim/mainnet-sim-results.json` (eseguite il 28/10/2026 alle 10:57 ora di Roma).

- Percorso: pool PumpSwap → curva pump.fun; entrambi i mint sono Token-2022.
- Quota per 0,01 SOL: ~1.447.854 SWANGY.
- Buffer per tolleranza 1% / 2% / 5%: ingresso 0,010128 / 0,010231 / 0,010554 SOL, margine 1,28% / 2,31% / 5,54%.
- Transazione unica: 1200 byte (1229 con priority fee e wSOL da creare), ~198.655 CU, simulazione riuscita.
- Fallback a due transazioni: swap 1090 byte / 144.896 CU; blocco 487 byte / 42.134 CU (simulato su un
  detentore reale di SWANGY, vedi §6).
- E2E simulato a transazione unica: totale 0,01579352 SOL a tolleranza 2% (di cui 0,00269748 SOL di depositi
  restituiti a fine pass e 0,00286004 SOL di configurazione una tantum alla prima volta).
- E2E «Attiva»: lo scambio arriva, il blocco no → schermata Attiva → seconda richiesta → pass attivo.
- Riporta nel wallet: oggi nessun pass SWANGY terminato on-chain e Jupiter non ha percorso per la commissione
  del 2% (`NO_ROUTES_FOUND`) → il gioco mostra «Non ancora possibile… riprova più tardi».

## 4. E2E con wallet finto (screenshot in `docs/screens`)

`scripts/screens/pass.mjs` su `dist-dev` con `?mockpass=…` (solo build DEV; in release il modulo non esiste).

| File | Schermata |
|---|---|
| `20-pass-connect-it.png` | Connetti wallet |
| `21-pass-offer-it.png` | Offerta |
| `22-pass-review-it.png` | Controlla e conferma (totale, minimo, fine, margine, dettaglio) |
| `23-pass-details-it.png` | Dettagli (programma, mint con Copia, frase del 2%, avviso di rischio) |
| `24-pass-wallet-it.png` | Approva nel wallet |
| `25-pass-confirming-it.png` | Conferma sulla rete |
| `26-pass-active-it.png` | Pass attivo, Gioca abilitato |
| `27-pass-review-en.png` | Review in inglese |
| `28-pass-activate-en.png` / `29-pass-active-en.png` | Recupero «Activate» e pass attivo |
| `30-pass-declined-it.png` | Rifiuto nel wallet |
| `31-pass-release-connect-it.png` | Build release: nessun mock, Gioca bloccato |

## 5. Proxy RPC (Worker `server/`, **non pubblicato**)

`POST /rpc`: allowlist di 14 metodi, parametri rigidi, `getProgramAccounts` solo sui pass di un wallet per
SWANGY, `sendTransaction`/`simulateTransaction` solo con i programmi del pass, nessun batch, corpo ≤ 8 KB,
origini consentite esatte (`RPC_ALLOWED_ORIGINS`), limiti per IP (240 richieste/min, 20 tx/min; per colo,
quindi approssimati). L'URL upstream è un **segreto** (`RPC_UPSTREAM_URL`), mai nel codice.

**Scoperta importante (28/10/2026):** l'RPC pubblico `api.mainnet-beta.solana.com` risponde **403** a ogni
richiesta con un header `Origin` del browser (anche `https://localhost`) e alle richieste in uscita dai Worker
Cloudflare («Your IP or provider is blocked»). Conseguenze:
- l'upstream del Worker deve essere un **RPC privato** (Helius, Triton, QuickNode…), non quello pubblico;
- nell'APK il fallback pubblico funziona solo con HTTP nativo: in `android-host/capacitor.config.json` è stato
  attivato `CapacitorHttp` (le `fetch` passano dal lato nativo, senza `Origin`). Da verificare sul Seeker;
- finché il proxy non è pubblicato (`PASS_RPC.proxyUrl = null`) il gioco usa solo il fallback pubblico.
Gli screenshot E2E usano un relay locale di sola lettura (`scripts/screens/devrelay.mjs`, rifiuta `sendTransaction`).

## 6. Limiti e deviazioni noti

- «Riporta nel wallet» può restare in attesa finché non esiste un percorso Jupiter per la commissione del 2%.
- Massimo 64 pass per wallet (limite dell'ID di blocco).
- L'account wSOL temporaneo non viene chiuso se esisteva già (nessuna perdita: resta del giocatore).
- La prima volta in assoluto si paga anche il registro volume dell'exchange (~0,0013462 SOL, non restituito).
- Il passo di blocco della variante a due transazioni è stato simulato con l'importo di un detentore reale
  (non si può simulare una catena di due tx dipendenti senza firmarle).
- Token di autorizzazione MWA in memoria / `secureStore` dell'host, non in `localStorage` (deviazione voluta).
- Origine nativa assunta `https://localhost` (Capacitor); `WALLET_IDENTITY.uri` è ancora PENDING.
- Card sponsor Scan: solo annotata (brief §10), mai nelle schermate del pass.

## 7. Cosa può verificare solo Michele (Seeker, mainnet, firma reale)

1. Installare l'APK, aprire il gioco: Gioca bloccato, offerta visibile.
2. Connetti → Seed Vault/wallet mostra l'identità del gioco; approvare.
3. Ottieni il Daily Pass → confrontare il totale mostrato con quello del wallet (devono coincidere al lamport,
   salvo la priority fee se il wallet la modifica) e il minimo garantito.
4. Firmare **una** richiesta; il pass diventa attivo; Gioca si sblocca; fine pass corretta in ora locale e UTC.
5. Chiudere e riaprire il gioco: il pass resta attivo (letto dalla catena).
6. Rifiutare una richiesta: «Non è stato inviato nulla».
7. Uscire dal wallet a metà / perdere la rete: «Esito non ancora confermato» → Controlla di nuovo, mai doppio invio.
8. Dopo 24 h: pass terminato in elenco, «Riporta nel wallet» (oggi probabilmente in attesa, vedi §6).
9. Verificare su un explorer che SWANGY e depositi tornano nel wallet e che la commissione del 2% compra e brucia PASTA.

## 8. Approvazioni necessarie prima della pubblicazione

- Pubblicare il Worker (`wrangler deploy`), impostare il segreto `RPC_UPSTREAM_URL` (RPC privato) e
  `RPC_ALLOWED_ORIGINS`; poi inserire l'URL in `PASS_RPC.proxyUrl` e nella CSP (`connect-src`).
- App ID (`app.seekandstrike.PENDING`) e dominio; `WALLET_IDENTITY.uri` (oggi PENDING).
