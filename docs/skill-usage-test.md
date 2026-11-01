# Skill usage test — Porto Vecchio architecture (2026-11-01)

Purpose: use SEEK & STRIKE as a real test of the **DevFridge Game Builder v1.10.0** skill (world.devfridge.cool/skill), especially the new landscapes/architecture pack, and record which skill files were actually used and what they changed.

## Skill files used

| Skill file | Used for |
| --- | --- |
| `references/landscapes-and-architecture.md` | Routing ("buildings, façades, roofs" → procedural architecture) and the Seeker rules applied: `WebGLRenderer`, budget written first, few draw calls, one tight shadow, look at the result. |
| `vendor/threejs-graphics-skills/threejs-procedural-architecture/SKILL.md` | Required pipeline (settings → mass → exposed-surface graph → placements → material-slot writer) and the acceptance list (silhouette, grazing light, seed variation, triangle/module reporting). |
| `…/threejs-procedural-architecture/references/grammar-and-mesh-compiler.md` | §1 plan/compile boundary, §2 dimensional constants (here: 4.4 m bays, ~4.6 m floors for 19th-century port warehouses), §3 compound footprints as rectangles + exposed-edge interval subtraction, §6 one geometry per material slot, §9 adaptation order. |
| `references/performance-and-capture.md` (via the 50 FPS rule) | Measured before/after; trims stopped casting shadows after the first measurement. |

Not used this time: vegetation, water optics, atmosphere, weather (Porto Vecchio already has HDRI sky and a sea surface; adding them is a later pass), `lightmap-baker` (would need UV2 and a bake step; worth it for the static warehouses later).

## What was built

- `client/src/render/architecture/plan.ts` — pure plan: buildings from the map's own collision boxes (so visuals match what bullets hit), exposed walls only, plinth / string courses / cornice / windows with sills, seeded style per building (plaster tint, arched or square windows). 15 tests (`plan.test.ts`, `compile.test.ts`).
- `client/src/render/architecture/compile.ts` — material-slot writer: wall, stone, window, roof → **4 draw calls**, **34,774 triangles** for all 19 Porto Vecchio buildings (1,227 windows). Every triangle faces outward; nothing sticks out more than 0.32 m from a collision box.
- `client/src/game/mapLoader.ts` — generic map registry (`banchina-est`, `porto-vecchio`), map choice in the menu (remembered), OSM attribution shown; Porto Vecchio is offline-only (the online room uses Banchina Est).

## Bugs the test exposed (fixed)

1. **Players fell off maps larger than 160 m** (`client/src/physics/world.ts`): the ground slab and boundary walls were fixed at ±80/±100 m. Now sized from the map bounds.
2. **Pipeline maps without patrols crashed the loader** (`shared/src/map/pipeline.ts`): `build-map.mjs` writes `patrols: null`, the converter called `.map` on it. Now two default loops are derived around the objective; bots also hold the objective if a map has none (`shared/src/sim/bot.ts`). Regression test `pipeline-patrols.test.ts`.
3. Menu subtitle and the "BLOCKOUT" banner were hard-coded to Banchina Est.

## Measurements (desktop, not Seeker)

Intel Iris Xe (integrated), Chrome, 1920×841, dev build, 3 s windows from the in-game governor:

| Scene | FPS samples | Tier |
| --- | --- | --- |
| Banchina Est (baseline) | 66–77 | 0 |
| Porto Vecchio, first version | 48–69 | 1–2 |
| Porto Vecchio, trims without shadows | 72–85 | 0 |

These are **not** Seeker measurements and do not satisfy the 50 FPS release gate, which needs a physical Seeker.

## Findings for the skill itself

- The project still vendors skill **1.7.6** (`../devfridge-game-builder-skill/`); 1.10.0 was read from the DevFridge repository.
- The 1.9.0 subscription rule ("any active deposit grants access, never compare the amount") differs from this game's Daily Pass, which checks a receipt plus a `passFloorRaw` threshold. With PASTA as the pass token, the 1.9 rule would also admit every wallet that already has a PASTA lock (there are ~98 on mainnet). That is an owner decision, not changed here.
- `threejs-procedural-architecture`'s example is a financial tower; adapting it to low warehouses was straightforward because the reference separates grammar from modules. The skill could add a short "low-rise / historic warehouse" note.

---

# Second pass — sea, sky and baked light (2026-11-01)

## Skill files used

| Skill file | Used for |
| --- | --- |
| `vendor/threejs-graphics-skills/threejs-atmosphere-aerial-perspective/SKILL.md` | Tier choice ("small scene, no orbital camera → analytic height/distance approximation"); one sky model shared by sky dome, sea reflection, haze and image-based light, with the same sun direction. |
| `vendor/mengto-threejs-skills/threejs-landscape/SKILL.md` | Six-stop sky gradient with the horizon stop just below the geometric horizon (haze colour = horizon stop, no seam); polar grid denser near, domain warp before octaves, ridges scaling with distance, colour from slope/height; the "watch the winding" check became a test. |
| `vendor/threejs-graphics-skills/threejs-water-optics/SKILL.md` | Analytic surface build order: bands defined once, normal derived from the same bands, **normal-only** water (declared), absorption **fallback** constant (declared), Schlick Fresnel instead of constant opacity, no fake scrolling foam, derivative filter for sub-pixel bands. |
| `references/landscapes-and-architecture.md` | `WebGLRenderer`, written budget, cheap-by-construction rules, "bake the light of static scenery". |

`lightmap-baker` (recommended by the skill) could **not** be used: it requires `three >=0.185.1 <0.186.0` and this game ships `three 0.186.1`. Instead: `shared/src/light/skyOcclusion.ts` (sky occlusion against the map solids) + `tools/light-bake/bake-ground-ao.mjs` (offline bake → `public/assets/maps/porto-vecchio/ground-ao.png`, 1024², 172 KB, ~11 s). The same code computes per-vertex façade occlusion once at load. Both are applied to **indirect light only** (aoMap / vertex attribute), so sunlit surfaces are not darkened. A test fails if `colliders.json` changes without re-baking.

## What was built

- `client/src/render/environment/sky.ts` — sky model, sky dome, PMREM environment from the same sky, haze = horizon stop (FogExp2). Sun from the map's authored environment (azimuth 235°, elevation 22°, late afternoon over the gulf) instead of the global default.
- `client/src/render/environment/sea.ts` — analytic sea (4 bands, Fresnel, sky reflection, sun glint, filtered bands), one disc to the horizon.
- `client/src/render/environment/hills.ts` — Carso backdrop east of the port (one draw call, < 8k triangles, faces checked).

## Bug exposed and fixed

- **Players could walk on the sea.** The physics floor covered the whole map. Pipeline maps now expose their OSM land slabs (`MapDef.groundSlabs`); the floor exists only there, and falling into the sea is a water death (`Match.stepWater`). Banchina Est has no land slabs and keeps its full floor. Tests: `pipeline-patrols.test.ts`, `water.test.ts`.

## Measurements (desktop Intel Iris Xe, not Seeker)

- Busy spots with sky, sea, hills and baked light: **68–74 FPS, tier 0** (Banchina Est on the same machine: 66–77).
- Load: architecture + façade occlusion **~1.06 s** on this PC; expect several seconds on a phone. If that is too slow on the Seeker, bake the façade occlusion offline like the ground.

---

# Third pass — vegetation (2026-11-01)

## Skill files used

| Skill file | Used for |
| --- | --- |
| `vendor/threejs-graphics-skills/threejs-procedural-vegetation/SKILL.md` | Build sequence (species table → queue growth → rings → section evolution → stratified/permuted children → leaves after topology → rooted wind) and its failure list (per-level budget, rooted leaf wind, seeds vary the individual not the species). |
| `…/threejs-procedural-vegetation/references/structured-ash-growth-system.md` | Continuation + lateral children, `sectionLength = length / sections`, gnarliness `max(1, 1/√r)·g`, force step `strength / r`, taper `1 − 0.7·i/n`, child radius coupled to the parent section, interpolation from B toward A, double perpendicular cards with rounded normals, leaf-only wind weighted by the card's V. |
| `…/examples/structured-ash-growth/tree-system.js` | Structure of the growth loop (read, not copied). |
| `vendor/mengto-threejs-skills/threejs-landscape/SKILL.md` | Grass anchored near the camera (32 m tiles shown within 48 m), wind in the vertex shader, per-instance colour variation. |

Intentional divergences from the ash contract (documented in `pine.ts`): our own *Pinus pinea* species table, needle-tuft cards drawn on a canvas instead of `ash.png`, real-distance bark V.

## What was built (`client/src/render/vegetation/`)

- `pine.ts` — stone pine grown as a hierarchy; ~2.4k triangles per tree; tests for budget, umbrella crown on a clear trunk, rooted cards, outward bark, seed behaviour. The first version broke the budget (5,830 triangles) and had a tall crown; the tests caught both and the species table was retuned.
- `placement.ts` — deterministic placement with a **fairness rule**: vegetation is render-only and bots see through it, so nothing that could hide a crouching player grows where people fight. Weeds ≤ 0.35 m, ivy flat on walls, trees (high crowns) only in a 12 m perimeter band away from spawns/objective. Trees are chosen in a seeded shuffled order (the first version put all 18 on the north edge).
- `vegetation.ts` — 18 pines (3 grown variants, 6 draw calls), ~3,150 weed clusters (tiles), ~7,150 ivy leaves on shady façades (east/north, away from the late sun), ~520 low-poly holm oaks on the Carso. Canvas textures only, no new assets.

## Measurements (desktop Intel Iris Xe, not Seeker)

82–95 FPS at tier 0 with everything; vegetation costs ~7–8 % at the busiest spot. During one session the whole browser was throttled (menu at 15 FPS, Banchina Est at 20, Porto Vecchio at 1.5); it did not reproduce, but it means Porto Vecchio must be measured on a physical Seeker before release.
