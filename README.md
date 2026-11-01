# SEEK & STRIKE

*Every Seeker is a soldier.*

FPS realistico a obiettivi ambientato nel 2030 per Solana Seeker: Three.js + TypeScript + Vite + Rapier, distribuito come APK Android firmato con gioco e asset inclusi.

**Stato: Stage 2 — soldati rigged realistici, fucile in prima persona, logo e penetrazione per materiale, sul loop offline dello Stage 1 (mappa "Banchina Est").** Wallet e Daily Pass **non** sono ancora implementati: in release il pulsante Gioca resta disabilitato (tutto il gioco, offline incluso, richiede il Daily Pass).

- Brief e decisioni: `docs/brief.md` · bozza scheda Store: `docs/store-listing.md`
- Note tecniche sul riferimento GPLv3 (solo meccaniche): `docs/et-reference.md`
- Licenza: GPL-3.0-or-later (`COPYING`, riepilogo in `LICENSE.md`). Crediti di terze parti: `NOTICE.md`. Asset e provenienza: `ASSETS_LICENSES.md`. Sorgente corrispondente: `SOURCE_OFFER.md` (https://github.com/mikeminer/seekandstrike)
- Screenshot headless (SwiftShader, non sono prova di FPS): `docs/screens/`

## Cosa c'è nello Stage 1

- Controller FPS Rapier (KCC): corsa, scatto, accovacciato, a terra, salto.
- Fucile R-30 "Vettore" 6.8×51: balistica a proiettile (gravità, drag), rinculo, dispersione, ricarica, mira (ADS) con ottica red-dot.
- Salute, stato "ferito a terra" con resa, ondate di rinforzi.
- Bot a macchina a stati (5 attaccanti, 6 difensori, giocatore negli attaccanti).
- Obiettivo piazza/disinnesca la carica nel bunker, vittoria/sconfitta a tempo o per detonazione, riavvio.
- Controlli touch + tastiera/mouse; HUD ai bordi.
- Texture PBR CC0 (ambientCG) e HDRI CC0 (Poly Haven); la mappa resta **BLOCKOUT** etichettata.
- Simulazione condivisa in `shared/` a passo fisso 60 Hz; quality governor con obiettivo 50 FPS.

## Cosa aggiunge lo Stage 2

- Soldati rigged CC0 (Quaternius Universal Base Characters + Universal Animation Library 1/2): due fazioni, "Assalto" in multicam e "Difesa" in urbano grigio, con equipaggiamento procedurale (elmetto, piastra, tasche, zaino, ginocchiere, stivali) e varianti per soldato.
- Animazioni: fermo, cammino, corsa, scatto, accovacciato (fermo/in movimento), a terra (posa procedurale), mira su/giù, fuoco, ricarica, colpito, ferito a terra, morte, rialzarsi (rianimazione). Il fucile è posato sulla spalla e le mani lo seguono con IK a due ossa.
- LOD: scheletro e animazioni complete solo per i soldati più vicini (`detailedCharacters` del quality governor), gli altri usano mesh semplificate al 25 % e mixer a 20 Hz.
- Morte con **ragdoll Rapier** (11 capsule, giunti sferici, massimo 4 attivi, congelati dopo 4 s).
- Fucile in prima persona CC0 con fuoco, rinculo, mira ADS con red-dot aperto e ricarica animata (caricatore, mano sinistra, maniglia di armamento se vuoto).
- Logo SEEK & STRIKE nel menu (`GAME_LOGO_PATH`), icone Android segnaposto in `android-host/resources/`.
- Rinculo e ritardo d'arma a molla smorzata (codice adattato da Claude-of-Duty, MIT, © 2026 mshumer — `licenses/Claude-of-Duty-MIT.txt`). Fonti armi verificate e motivazione della scelta in `ASSETS_LICENSES.md` → "Weapon source review".
- Penetrazione per materiale: i container carichi fermano i proiettili, le casse di legno si attraversano, cemento e acciaio bloccano.

### Pipeline asset (offline, non inclusa nell'APK)

`tools/asset-pipeline/` converte i pacchetti sorgente (scaricati in una cartella di lavoro, hash in `ASSETS_LICENSES.md`) in `public/assets/models/soldier.glb` e `rifle.glb` (meshopt + WebP, LOD):

```
cd tools/asset-pipeline && npm ci && SRC=/percorso/sorgenti node build-assets.mjs
```

## Controlli

Desktop: WASD muovi · mouse guarda · clic sinistro fuoco · clic destro mira · R ricarica · Shift scatto · Spazio salto · C accovacciato · Z a terra · E (tieni) piazza/disinnesca · F arrenditi da ferito · Invio ricomincia.

Touch: stick sinistro muovi (spinto a fondo = scatto) · trascina a destra per guardare · pulsanti FUOCO, MIRA, RICAR., SALTO, ACCOV., A TERRA, AZIONE, ARRENDITI.

## Struttura

- `client/`: rendering Three.js (soldati, ragdoll, viewmodel), input, HUD, audio procedurale; `client/src/dev/lab.ts` è un banco di prova solo DEV
- `shared/`: simulazione comune (fisica, armi, bot, obiettivo, mappa, passo fisso, costanti)
- `server/`: Worker + Durable Object Cloudflare (segnaposto, **non deployato**)
- `android-host/`: segnaposto dell'host Android (nessuna firma, nessun keystore)

## Comandi (Node ≥ 22.12)

```
npm ci
npm run dev            # server di sviluppo Vite (bypass DEV del pass attivo)
npm run typecheck
npm test
npm run build          # build di RELEASE in dist/ (nessun bypass)
npm run check:release  # verifica che dist/ non contenga tracce del bypass DEV
npm run build:dev      # build DEV in dist-dev/ con bypass del Daily Pass (mai da pubblicare)
npm run server:check   # dry-run di wrangler, nessun deploy
```

### Bypass DEV del Daily Pass

`__DEV_PASS_BYPASS__` è una costante di Vite: `true` solo in `--mode development` o `--mode devbypass`, letterale `false` in release, quindi il ramo e il modulo `client/src/dev/automation.ts` vengono eliminati dal bundle. La build DEV mostra l'etichetta "DEV BUILD · Daily Pass bypass attivo". `npm run check:release` fallisce se nel bundle di release compare una traccia.

Parametri URL utili: `?debug` (overlay FPS/qualità), `?touch` (forza i controlli touch), `?seed=N`, `?lang=it|en`.

Non inserire mai chiavi, keystore o URL RPC con chiavi nel sorgente.
