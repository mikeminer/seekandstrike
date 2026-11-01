# Valutazione repository mappe 3D e piano Stage 3

*Data: 28 ottobre 2026. Ricerca in `/workspace/map-research` (cloni shallow); pipeline in `tools/map-pipeline/`.*
*Progetto: Seek & Strike (GPLv3, APK per Solana Seeker, three 0.186.1 + Rapier 0.21).*

## 1. Licenze e riuso

Regola applicata: si copia codice **solo** con licenza permissiva compatibile con GPLv3 (MIT, Apache-2.0, BSD) e
con il file LICENSE presente nel repo. Senza licenza = tutti i diritti riservati, quindi **solo riferimento/idee**.

| Repo (commit) | Licenza esatta | Copiabile in APK GPLv3? | Cosa è utile | Riuso | Rischi |
|---|---|---|---|---|---|
| **3dmap-creator** (`374eb616`, 12/10/2026) | MIT © 2026 DanielsApps; decoder Draco/Basis Apache-2.0 | **Sì** (mantenere copyright MIT) | Editor di mappe che esporta GLB con `userData` → `extras`: `mapType`, `collider` (none/box/ramp/sphere/capsule/mesh/trigger/heightfield), `marker` (spawn/waypoint/trigger/pointLight), `tags`, `props`; `src/runtime/MapLoader.js` | **Convenzione adottata** (la pipeline legge sia nomi nodo sia questi extras). Codice non copiato: l'abbiamo riscritto per Rapier + sim condiviso | Schema giovane, può cambiare; nessun supporto team/obiettivo, quindi usiamo anche i nomi `spawn_attack_*` ecc. |
| **HorrorGame** (`3c8081b2`, 19/06/2026) | **Nessun LICENSE** | **No**, solo riferimento | Mappe a tile codificate in canali PNG, idea semplice per layout | Idea | Diritti riservati |
| **NotBlox** (`9ee73b72`, 07/06/2026) | MIT **con clausola aggiuntiva anti-crypto/blockchain** | **No, vietato**: la clausola esclude l'uso in progetti crypto (noi abbiamo il Daily Pass su Solana) e una restrizione d'uso aggiuntiva non è compatibile con la GPLv3 | `TrimeshColliderSystem.ts` (GLB → trimesh Rapier lato server) | Al massimo l'idea generica (è comunque prassi standard Rapier). **Nessuna riga copiata**, implementazione nostra indipendente | Legale: alto se si copia anche poco |
| **threejs-games.github.io** (`e846d86b`, 09/02/2026) | **Nessun LICENSE**; modelli da 3D Warehouse/Sketchfab con licenze proprie | **No** | `city.js` (città procedurale a griglia), `heightmap.js` | Idea | Asset di terzi senza licenza chiara: non importare nulla |
| **threejs-maplibre** (`8ed80ad6`, 14/10/2026) | README/package.json dicono "MIT", ma **manca il file LICENSE** e il codice è "in arrivo" | **Non ancora**: solo riferimento finché non c'è un LICENSE | Overlay three su MapLibre, estrusione edifici da tiles vettoriali | Idea (estrusione edifici) | Usa tiles OpenFreeMap **online**: non utilizzabili offline né da impacchettare nell'APK; dipendenza di rete in gioco = no |
| **threejs-tower-defense** (`dcb33e16`, 15/03/2026) | MIT © 2026 Djordje Pavlovic | **Sì** | Generazione mappe seeded, pathfinding su griglia, spawn a ondate | Idea seed + griglia (riscritto nel nav baker); il codice si potrebbe copiare | Basso; è in 2D/griglia piatta, non 2.5D |
| **worldfolk** (`ea08a784`, 23/10/2026 15:51 ora di Roma) | Apache-2.0 (tenere NOTICE). Dati: ODbL. Umani Quaternius: CC0. Loghi/marchi esclusi | **Sì** per il codice (con NOTICE e indicazione delle modifiche); i **dati OSM sono ODbL** | `scripts/maps/extract.py` (osmium + shapely, altezza di default 4.5 m), tiles self-hosted, A* in Web Worker | **Euristiche adottate** (altezza da `height`/`building:levels`/default, filtri footprint) riscritte in JS; idea A* in worker | ODbL: attribuzione obbligatoria + share-alike sul database derivato |

### Dati OpenStreetMap (ODbL 1.0)
* La GLB generata è un **Produced Work**: obbligo di mostrare **"© OpenStreetMap contributors"** (crediti + schermata caricamento mappa).
  Già in `asset.copyright` della GLB e nell'HUD della preview.
* `porto-vecchio-ts.footprints.json` è un **Derived Database**: va pubblicato sotto ODbL insieme ai sorgenti (`examples/porto-vecchio-ts/footprints.odbl.json`).
* **Nessun tile o stile** di mappa è usato o impacchettato. Molti provider (OSM tile server, MapTiler, Mapbox, OpenFreeMap) vietano o limitano l'uso offline/bundle. Noi interroghiamo Overpass **una volta, a build-time**, e mettiamo in cache la risposta (`tools/map-pipeline/cache/`). Il gioco non fa mai richieste a OSM.

## 2. Cosa è stato costruito (`tools/map-pipeline/`, GPL-3.0-or-later)

```
npm install && npm run all && npm test && npm run preview
```
1. **Convenzione marker GLB**: nodi `spawn_attack_*`, `spawn_defend_*`, `objective_*`, `cover_*`, `nav_*`, `trigger_*`, `light_*`, oppure extras stile 3dmap-creator. Yaw 0 = verso −Z (come lo sim).
2. **`build-map.mjs`**: GLB → `markers.json` (`seek-strike-markers` v1, con grafo waypoint) · `colliders.json`
   (cuboid/trimesh/hull Rapier + `simBoxes` compatibili con `MapBox` dello sim condiviso) · `navgrid.json`
   (griglia 2.5D 0,5 m con raycast/shape-cast Rapier: altezza, walkable/reachable/water/crouch/piano superiore, bit di copertura) ·
   `render.glb` (marker rimossi, join per materiale, quantize, meshopt) · `report.json` con validazione (exit 1 se fallisce = gate CI).
3. **`nav-runtime.mjs`**: A* + snap senza dipendenze, utilizzabile da bot client/server (cammino "coperto" con penalità d'esposizione).
4. **`osm-bake.mjs`**: OSM → GLB offline per un quartiere portuale (~300 m), con file di attribuzione ODbL.
5. **`preview.mjs`**: screenshot headless (Chrome + SwiftShader) con heatmap nav, marker, percorsi A*.

### Risultati

| Mappa | Collider | Nav | Percorsi A* | Render GLB |
|---|---|---|---|---|
| **Banchina Est** (ricostruzione esatta di `portoArdesia.ts`) | 53 cuboid = 53 simBoxes (round-trip **identico** ai 52 box stage 1 + suolo, verificato da test) | 143×166, 21.305 celle raggiungibili | attacco→obiettivo 64,9 m; difesa→obiettivo 31 m; coperto 68,1 m | **9 draw call, 648 tri, 19 KB** |
| **Porto Vecchio – Trieste** (OSM, 280×300 m) | 19 edifici (3 box + 16 trimesh), 50 cuboid, 180 simBoxes (130 approssimati) | 560×600, 195.634 raggiungibili | 136,5 m / 140,5 m; 430 archi waypoint | **12 draw call, 1.324 tri, 29 KB** |

Preview: `docs/maps/banchina-est-{top,persp,fp}.png`, `docs/maps/porto-vecchio-ts-{top,persp,fp}.png`.
Esempi completi: `docs/maps/examples/<id>/` (source.glb, render.glb, markers.json, colliders.json, navgrid, report).

## 3. Piano Stage 3

### 3.1 Banchina Est rifatta con la pipeline
1. `source.glb` attuale = blockout esatto: lo sim continua a usare gli stessi box (round-trip testato), quindi **nessun rischio di desync**.
2. In Blender: sostituire i box con mesh dettagliate (container ondulati, bitte, gru, gru a cavalletto, binari), **tenendo collider box separati** (`collider: box`) o `collider: none` sui dettagli; i box di gameplay restano la verità dello sim.
3. Texture 1K KTX2 (atlas per materiale: container, cemento, metallo, legno) → 10–20 materiali max; instancing per container/casse/barriere.
4. `build-map` in CI: validazione marker + percorsi, budget triangoli/draw-call (fallire se superati).
5. Runtime: il client carica `render.glb` + `markers.json`; i bot usano `navgrid.json` + `nav-runtime.mjs` (A* in Web Worker come in worldfolk).
6. Verifica su Seeker fisico: 50 FPS stabili con 10 giocatori/bot, prima di tutto il resto.

### 3.2 Seconda mappa: "Porto Vecchio" ispirata a OSM (Trieste)
1. Base OSM già generata (magazzini storici in lunghe file, banchine, binari). Usarla come **blockout**, non come prodotto finito.
2. Aggiungere porte/interni ai magazzini 2–3 (ora sono volumi chiusi: nav li marca come non raggiungibili), passerelle, gru, scale per verticalità.
3. Bilanciamento: oggi i due spawn sono a ~137/140 m dall'obiettivo (equo); ridurre la mappa giocabile a ~180×200 m per 5v5 mobile, con barriere invisibili sul perimetro.
4. Nome/estetica "ispirata a": nessun marchio o logo reale; crediti ODbL nella schermata della mappa.

### 3.3 Requisiti sul simulatore condiviso
* Lo sim è **solo AABB**. Gli edifici OSM non rettangolari sono approssimati con `simRects` (rettangoli greedy da 1 m): ok per movimento/LOS ma imprecisi di ~0,5 m sugli spigoli obliqui.
* Per balistica esatta servono: **OBB** (box ruotati, poco costo) e in seguito **trimesh statici** nello sim deterministico (oppure Rapier anche lato sim). Fino ad allora: allineare le mappe alla griglia (`alignToGrid`, rotazione dominante −22° per Porto Vecchio) e preferire volumi rettangolari.

## 4. Budget per Solana Seeker (target 50 FPS)

| Voce | Budget |
|---|---|
| Draw call per frame (scena + personaggi + armi + UI 3D) | **≤ 100–150** (mappa statica ≤ 40) |
| Triangoli visibili | **150k–300k** (mappa ≤ 120k, ogni personaggio ≤ 10–15k con LOD) |
| Texture | **1K** (2K solo per l'arma in prima persona), KTX2/ETC1S o UASTC, WebP come fallback; ≤ 64 MB di VRAM in texture |
| Ombre | **una** DirectionalLight, shadow map **1024**, niente ombre per luci puntiformi |
| DPR | **≤ 1,5** |
| Luci | 1 sole + hemisphere + light probe/baked AO; luci puntiformi solo baked |
| Geometria | join per materiale, instancing (container, casse, barriere), meshopt + quantize; LOD o impostor per edifici lontani |
| Fisica | collider semplici (box/hull); trimesh solo per edifici statici; nav baked offline (mai a runtime) |

Gli attuali `render.glb` sono molto sotto budget (9–12 draw call, < 1,5k tri): c'è ampio margine per il dettaglio.
**Le preview SwiftShader non sono prove di FPS.** Il gate resta la misura su un Seeker fisico.

## 5. Rischi e limiti noti
* Overpass è instabile (504 da overpass-api.de / kumi; ha funzionato maps.mail.ru): rigenerare raramente e tenere la cache versionata.
* Gli edifici OSM non hanno porte né interni; le altezze sono stimate quando mancano `height`/`building:levels`.
* Il codice di NotBlox non va mai copiato; threejs-maplibre, HorrorGame e threejs-games vanno trattati come solo riferimento.
* Pipeline non provata su export reali di 3dmap-creator/Blender: la convenzione è implementata secondo lo schema letto, ma serve un primo file di prova.
