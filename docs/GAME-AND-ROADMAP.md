# SEEK & STRIKE — il gioco, lo stato attuale e la roadmap

> Documento di passaggio di consegne per chi continua lo sviluppo (persona o altra AI).
> Aggiornato al **2 novembre 2026**, versione app **0.4.4** (versionCode 15), commit `8061d52` su `main`.
> Sostituisce le parti superate di `../HANDOFF.md` (per esempio il pass oggi usa **PASTA**, non SWANGY, e c'è una
> partita gratuita al giorno). In caso di dubbio vale il codice, poi questo file, poi HANDOFF.md.

---

## 1. In una frase

**SEEK & STRIKE** è uno sparatutto tattico in prima persona per il telefono **Solana Seeker**: round di 6 minuti
attacco-contro-difesa (gli attaccanti piazzano una carica, i difensori resistono o la disinnescano), squadre da 5-6,
rinforzi a ondate, cinque classi con ruoli diversi, quattro mappe, offline contro bot e online con voce di squadra e
classifica settimanale. L'accesso illimitato e l'online passano da un **Daily Pass** on-chain (0,01 SOL per 1 giorno).

- Motto: **"Every Seeker is a soldier."** (sempre in inglese)
- Owner: Michele Angelo Forlani (GitHub `mikeminer`)
- Licenza: **GPL-3.0-or-later** (codice pubblico)
- Ispirazione: le *meccaniche* di Wolfenstein: Enemy Territory (GPL). Nessun nome, asset o marchio di ET o di altri
  giochi: tutto è originale.

## 2. Link

| Cosa | Dove |
|---|---|
| Codice | https://github.com/mikeminer/seekandstrike (branch `main`) |
| Sito | https://seekandstrike.it (privacy: `/privacy`, termini: `/terms`) — sorgenti in `site/`, Vercel progetto `seekandstrike-site` |
| Server di gioco + proxy RPC | https://seek-and-strike-server.4n0nym0u5-cyber.workers.dev (Cloudflare Workers + Durable Objects) |
| APK firmati | `C:\Users\mikfo\Documents\SeekAndStrike\release\` (un `RELEASE-x.y.z.md` per ogni versione) |
| Materiale store | `docs/store/` (testi 17 lingue, schermate it/en, trailer 1080p, icona 512) |
| Dominio | `seekandstrike.it` su Register.it (A → 76.76.21.21, www → cname.vercel-dns.com; posta/PEC intatte) |

## 3. Cosa c'è nel gioco oggi (0.4.4)

### Partita
- Modalità attacco/difesa con carica da piazzare (piazzamento, innesco, disinnesco, tempo supplementare).
- **Rinforzi a ondate ogni 8 s (attacco) / 10 s (difesa)**, ferito 12 s (rianimabile), **2,5 s di protezione alla
  ricomparsa** (finisce quando spari), ricomparsa nel punto più lontano dai nemici.
- Bot con macchina a stati (pattuglia, avanzata, ingaggio, copertura, obiettivo, indagine), granate, rianimazioni,
  rifornimento, uso delle armi di classe; tre difficoltà (Recluta/Regolare/Veterano) e "riscaldamento" dei primi 20 s.
- Movimento: corsa, scatto con fiato, salto, accovacciato, a terra; annegamento nelle mappe portuali.

### Classi e armi

| Classe | Arma | Ruolo |
|---|---|---|
| Soldato | R-30 Vettore + **LR-1 Martello** (lanciarazzi, secondaria, pulsante ARMA / Q) | assalto, razzi contro gruppi e postazioni |
| Medico | R-30 | rianima i feriti, rigenera fino a 100 |
| Geniere | R-30 | piazza e disinnesca 1,6× più in fretta |
| Field Ops | R-30 | **rifornisce di munizioni** i compagni entro 3,5 m (e i bot vengono da te) |
| Incursore | **SR-7 Falco** (precisione, cannocchiale 16°) | cecchino; più fiato nello scatto |

Armi definite in `shared/src/sim/weapons.ts` (`WEAPONS`, `weaponById`), dotazioni in `classStats.ts` (`classLoadout`).
Razzo = variante della granata (`grenade.ts`, `ROCKET`): volo quasi piatto, esplode al contatto con mappa o soldato.

### Mappe (tutte giocabili offline e online)
1. **Banchina Est** (Porto di Ardesia) — terminal container, bunker di controllo.
2. **Magazzini del Sale** — quartiere di magazzini, cortile murato.
3. **Scalo Ferroviario** — binari e vagoni, cabina di segnalamento.
4. **Trieste — Porto Vecchio** — ricostruita da OpenStreetMap (ODbL, attribuzione nel gioco e sul sito).

Pipeline: le mappe nascono come `MapDef` TypeScript (`shared/src/map/*.ts`) o da OSM, passano da
`tools/map-pipeline` (GLB → collisioni, navgrid, marcatori, validazione) e la grafica degli edifici è procedurale
(`client/src/render/architecture/`). Cielo, mare, colline, luce precalcolata (AO a terra), vegetazione solo ai bordi
(regola di equità: niente erba alta che i bot "vedono attraverso").

### Meta e interfaccia
- **Progressione** solo estetica: 50 livelli e gradi, 11 sblocchi (finiture del fucile, colori del punto),
  3 sfide giornaliere + 3 settimanali, statistiche, riepilogo XP a fine partita (`client/src/meta/`).
- **Tutorial** di 60 s alla prima partita. **Impostazioni**: sensibilità visuale/mira, aiuto alla mira touch,
  volume, voce, difficoltà bot, nome in partita, lingua.
- **17 lingue** (quelle dell'app dApp Store): en, it, ar, de, es, fr, hi, ja, ko, nl, pl, pt, ru, th, uk, zh, zh-TW.
  **Inglese predefinito** (decisione owner), le altre dalle Impostazioni. Pacchetti in `client/src/i18n/packs/`,
  tradotti a macchina: **serve revisione madrelingua** (prima i testi del Daily Pass).
- Riscontro colpi: segnalino, colpo alla testa, "+100 ABBATTUTO", direzione del danno, suoni procedurali (WebAudio).
- Schermo intero immersivo, niente selezione del testo a pressione lunga.

### Online
- Server autoritativo su **Cloudflare Durable Objects** (`server/`): una stanza per nome, `<mappa>-<n>` sceglie la
  mappa (`lobby-<n>` = Banchina). Partita rapida tra `<mappa>-1..8`. 8 umani per stanza, i posti liberi sono bot.
- Ingresso solo con **Daily Pass verificato**: il wallet firma un testo (non una transazione), il server legge la
  catena tramite il proxy RPC.
- Predizione lato client, interpolazione, compensazione del lag, riconnessione con lo stesso posto.
- **Classifica settimanale** (Durable Object SQLite): punteggio calcolato dal server
  (abbattimenti × 100 + vittorie × 300 + round × 50), solo wallet verificati, nome + wallet abbreviato.
- **Voce di squadra push-to-talk**: Opus 16 kbps via WebCodecs, inoltrata solo ai compagni, mai salvata.
- `GET /health` dichiara `maps`, `leaderboard`, `voice`: il client attiva le funzioni solo se il server le annuncia.

### Daily Pass (on-chain)
- Una partita offline gratuita al giorno senza pass (decisione owner del 2/11/2026); il pass sblocca partite
  illimitate e l'online per 1 giorno.
- Acquisto in **una transazione**: 0,01 SOL → token **PASTA** nella pool Meteora DAMM v2 → deposito per 1 giorno nel
  programma **Fridge**. A fine pass il token torna al wallet ("Riporta nel wallet"), con la commissione del 2% del
  programma. Validatore della transazione in TypeScript **e** in Java nativo (39 vettori di test identici).
- Tutto il codice è in `client/src/pass/`. `client/src/pass/vendor/*.mjs` sono copie della skill: **non modificarle**.
- Simulazione in sola lettura del flusso reale: `client/src/pass/__sim__/owner-purchase.sim.ts`.

### Prestazioni misurate sul Seeker (11 soldati, qualità massima)
Banchina 70/102 fps (min/mediana), Magazzini 78/97, Scalo 69/98, Porto Vecchio 66/80. Soglia di rilascio: ≥ 50 fps.

## 4. Architettura in breve

```
seek-and-strike/
  shared/src/        simulazione deterministica condivisa client+server (sim/, map/, protocol.ts, voice.ts, config.ts)
  client/src/        gioco nel browser/WebView: game/, render/, input/, ui/, meta/, online/, pass/, i18n/, audio/
  server/src/        Cloudflare Worker: index.ts, room/ (MatchRoom, RoomSim), leaderboard/, rpc/ (proxy RPC)
  android-host/      Capacitor 8; android/ contiene MainActivity (immersivo, blur MWA), PassValidatorPlugin, TxValidator
  tools/             map-pipeline/, light-bake/, validator-vectors/
  site/              sito seekandstrike.it (statico)
  docs/              brief, online.md, store/, questo file
```

Principi da rispettare:
- **Tutta la logica di gioco sta in `shared/src/sim`** ed è deterministica: lo stesso codice gira offline nel client
  e autoritativo sul server. Una regola nuova va lì, con test, e poi si collega al protocollo.
- **Una sola implementazione per ogni comportamento.** Lezione imparata: il difetto della mira era stato corretto
  offline ma ne esisteva una copia nel client online (`mirror.ts`). Prima di dire "risolto", cercare tutte le copie.
- Il client online ignora gli eventi che non conosce: un server più nuovo non deve mai rompere un'app più vecchia.

## 5. Comandi

```bash
npm ci                      # dipendenze (root); tools/map-pipeline ha il suo npm ci
npm run typecheck           # client + server
npx vitest run              # 387 test (tutti devono passare)
npm run build               # build web di release in dist/
npm run check:release       # nessun bypass DEV nel bundle: obbligatorio prima di ogni APK
npm run build:dev           # build DEV (bypass pass + diagnostica) in dist-dev/
npm run server:dev:online   # server locale senza obbligo di pass (porta 8787)
node scripts/online-smoke.mjs   # 8 client finti contro il server locale (SMOKE_MAP=<mappa> opzionale)
```

APK (Windows, vedi i `RELEASE-*.md`): `npm run build && npm run check:release` → `cd android-host && npx cap sync android`
→ `gradlew.bat :app:testReleaseUnitTest :app:assembleRelease` (JDK Temurin 21,
`JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`) → `zipalign` + `apksigner` con la chiave
`%USERPROFILE%\.android\seekandstrike-signing\seekandstrike-release.p12` (alias `seekandstrike`, password protetta da
DPAPI, **mai** nel repo). Ogni aggiornamento: stessa chiave, `versionCode` più alto.

Deploy (solo con l'ok dell'owner): `npx wrangler deploy -c server/wrangler.toml` (server) e
`cd site && npx vercel deploy --prod` (sito).

## 6. Regole che non si toccano

1. Mai firmare o inviare transazioni reali durante sviluppo e test; solo letture e `simulateTransaction` (sigVerify off).
2. Nessuna chiave di RPC a pagamento nel client/APK: solo il secret `RPC_UPSTREAM_URL` del Worker.
3. Nessun deploy (server, sito, store) senza l'approvazione esplicita dell'owner.
4. Il primo acquisto reale lo fa l'owner sul suo Seeker.
5. Nessun keystore, password, `.env` o secret nel repo.
6. `npm run check:release` prima di ogni APK; nessun bypass in release.
7. Testi per il giocatore senza la parola "prezzo" e senza promesse di guadagno: il pass è accesso al gioco.
8. Asset solo con licenza verificata (CC0/OFL/MIT con attribuzione) o generati.
9. Equità: niente vantaggi a pagamento in partita; le ricompense sono estetiche.

## 7. Punti aperti (prima del lancio)

- [ ] Revisione madrelingua delle 15 traduzioni (soprattutto Daily Pass e Termini).
- [ ] Primo acquisto reale del pass dall'owner; prova online con pass tra due telefoni (voce, classifica).
- [ ] "Riporta nel wallet" dei depositi PASTA scaduti: verificare con simulazione dopo aver messo SOL sul wallet.
- [ ] Invio al **Solana dApp Store** (portale publisher con wallet dell'owner).
- [ ] Indirizzo email di contatto (oggi: issue su GitHub).
- [ ] Copia di sicurezza offline della chiave di firma (perderla = app non più aggiornabile).
- [ ] Modelli in terza persona del lanciarazzi e del fucile di precisione; mani sul lanciarazzi.
- [ ] Misura FPS dopo le armi nuove (esplosioni dei razzi) sul Seeker.

## 8. Roadmap futura

Le idee sotto vengono dalla lista dell'owner ("un gioco di guerra che si distingue: mondo vivo, conseguenze reali,
libertà di strategia"). Le ho ordinate per **impatto sul giocatore / fattibilità su un telefono** (Seeker: GPU mobile,
batteria, touch, partite brevi). Ogni voce ha un criterio di accettazione misurabile.

### Fase A — "mondo vivo" leggero (alto impatto, fattibile subito)

1. **Ciclo giorno/notte e meteo dinamico** (idee 2 e 12).
   Cielo, luce del sole, nebbia e pioggia già hanno una base (`client/src/render/environment/`). Aggiungere: preset
   alba/giorno/tramonto/notte per round, pioggia (particelle + suono + strade bagnate), nebbia che riduce davvero la
   **vista dei bot** (`BotSkill.viewDistance`) — altrimenti è solo estetica e i bot barano.
   *Accettazione:* il meteo cambia la distanza di avvistamento dei bot in modo testato; ≥ 50 fps sul Seeker con pioggia.

2. **Copertura distruttibile** (idea 1, versione mobile).
   Non crolli di edifici interi (troppo costoso), ma **elementi a pezzi**: casse, barriere, pareti leggere di lamiera
   che si rompono con razzi/granate e lasciano detriti; la collisione e la linea di vista si aggiornano nella sim
   condivisa (box che spariscono/si accorciano) e vengono sincronizzati online.
   *Accettazione:* un razzo apre un varco attraversabile; i bot ricalcolano i percorsi; stesso stato su tutti i client.

3. **IA che si coordina** (idea 3).
   Squadre di bot con un "caposquadra": fuoco di copertura mentre un altro avanza, aggiramento quando un difensore
   tiene un corridoio, memoria delle posizioni da cui sono stati colpiti, granate nei punti dove il giocatore si
   nasconde spesso (memoria per round).
   *Accettazione:* nei test sim i bot che aggirano vincono più spesso contro un difensore statico.

4. **Segnalazioni e radio** (idea 14, versione pratica).
   Il marcatore "nemico qui" (già pensato per l'Incursore), ping rapidi (attacca / difendi / serve medico / servono
   munizioni) e una radio con frasi pronte tradotte; i bot rispondono alle richieste (il medico arriva, il Field Ops
   porta munizioni).
   *Accettazione:* ogni ping visibile alla squadra online entro 200 ms; i bot reagiscono alle richieste.

5. **Soldati con identità** (idea speciale "soldati con una vita propria").
   Ogni bot ha nome, grado, carattere (prudente/aggressivo), statistiche che crescono tra le partite e frasi proprie;
   "il tuo rivale": il bot nemico che ti ha abbattuto più volte torna e viene segnalato.
   *Accettazione:* profili bot persistenti sul dispositivo; il carattere cambia davvero il comportamento.

### Fase B — conseguenze e persistenza (distintivo, medio sforzo)

6. **Fronte settimanale persistente** (idee 4, 13 e "territorio modificabile").
   Una "campagna" che dura la settimana della classifica: le mappe sono settori di un fronte; i round online vinti
   spostano la linea; il settore conquistato cambia l'obiettivo e l'aspetto della mappa (barricate, crateri,
   bandiere) per tutti. Vive in un Durable Object come la classifica.
   *Accettazione:* lo stato del fronte è uguale per tutti i giocatori e si vede nel menu; reset settimanale.

7. **Comandante sostituibile** (idea speciale).
   Nell'online, un giocatore per squadra è il comandante (il più alto in grado): vede la mappa tattica e può piazzare
   un ordine; se viene abbattuto il ruolo passa al successivo.
   *Accettazione:* passaggio automatico del ruolo; ordini visibili a tutta la squadra.

8. **Mappe con ambienti sotterranei** (idea 10).
   Una mappa con tunnel/bunker su due livelli (la pipeline supporta già `UPPER` nella navgrid): gallerie strette,
   uscite multiple, combattimento ravvicinato.
   *Accettazione:* navgrid valida su due livelli; bot che usano i tunnel.

9. **Personalizzazione** (idea 11).
   Accessori estetici per le uniformi, mimetiche per mappa, ottiche alternative (solo estetiche o con
   compromessi equilibrati), loadout per classe salvati.
   *Accettazione:* nessun vantaggio a pagamento; tutto sbloccabile giocando.

### Fase C — grandi ambizioni (valutare costi/benefici)

10. **Veicoli** (idea 8) — per il Seeker conviene **un solo tipo** ben fatto (per esempio un mezzo leggero o un drone
    da ricognizione dell'Incursore) prima di carri/aerei. Richiede fisica dei veicoli, rete e mappe più grandi.
11. **Mappe più grandi / mondo esplorabile** (idea 6) — streaming della mappa a settori; attenzione a memoria e batteria.
12. **Battaglie più grandi** (idea 15) — 8 umani per stanza sono il limite attuale; 12-16 richiedono di ottimizzare
    banda e CPU del server (snapshot delta, area di interesse).
13. **Civili** (idea 9) — sconsigliato nella forma "civili da colpire" (store e pubblico); possibile come evacuazione da
    proteggere in una modalità a obiettivo.
14. **Ferite e fatica realistiche** (idea 5) — solo come scelta di modalità "Realistico" (per il pubblico mobile
    fame/sete appesantiscono); possibile: ferite agli arti che rallentano, curabili dal Medico.
15. **Guerra economica** (idea speciale) — risorse della fazione (munizioni, carburante) legate al fronte settimanale.
16. **Spettatore/centro di comando** (idea speciale) — modalità spettatore delle stanze online con mappa tattica:
    utile anche per tornei e per lo streaming.
17. **Comando di unità** (idea 7) — comandare squadre di bot offline (ordini "tieni qui / segui / attacca") è
    fattibile e piacerebbe: estende la Fase A punto 3.

### Ordine consigliato
A1 meteo/notte → A4 segnalazioni e radio → A3 IA coordinata → A2 copertura distruttibile → B6 fronte settimanale →
A5 identità dei soldati → B7 comandante → B8 mappa sotterranea → poi Fase C secondo i risultati dello store.

## 9. Come lavorare su questo progetto (per chi continua)

- Leggere questo file, poi `docs/online.md` e i `RELEASE-*.md` più recenti.
- Per ogni modifica di gameplay: codice in `shared/src/sim` + test (Vitest) + collegamento online (protocollo,
  `server/src/room/roomSim.ts`, `client/src/online/mirror.ts`) + testi in **17 lingue** (`client/src/ui/i18n.ts`,
  `client/src/meta/strings.ts`, `client/src/i18n/packs/*.ts`: il tipo TypeScript impedisce di dimenticare una lingua).
- Le funzioni nuove dell'online vanno annunciate in `GET /health` e attivate nel client solo se il server le dichiara.
- Prima di ogni APK: `npx vitest run`, `npm run build`, `npm run check:release`, test Java del validatore; stessa
  chiave di firma, `versionCode` +1, `RELEASE-x.y.z.md` con SHA-256.
- Verificare sul telefono quello che riguarda la "sensazione" (mira, comandi, FPS): i problemi di feel si trovano
  misurando sul Seeker, non indovinando.
