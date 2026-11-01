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
