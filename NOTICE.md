# Third-party notices

This file lists upstream code and data used by SEEK & STRIKE and the obligations that come with them. Per-asset detail (creator, URL, hashes) is in [`ASSETS_LICENSES.md`](ASSETS_LICENSES.md).

## Wolfenstein: Enemy Territory GPL source

- Upstream: https://github.com/id-Software/Enemy-Territory, commit `40342a9e3690cb5b627a433d4d5cbf30e3c57698`.
- Copyright (C) 1999-2010 id Software LLC, a ZeniMax Media company.
- Licence: GPL-3.0-or-later plus the Additional Terms in [`licenses/Wolf-ET-Additional-Terms.txt`](licenses/Wolf-ET-Additional-Terms.txt).
- **Status today:** two files are ported from ET (table below). The rest of the gameplay in `shared/src/sim/` is written from scratch; ET is otherwise a mechanics reference only (`docs/et-reference.md`).
- The project as a whole stays GPL-3.0-or-later. The two ported files and any file that includes them additionally carry the ET Additional Terms (replaced §15/§16 warranty and liability text, legal notices, no trademark licence, indemnification).
- **When code is ported**, for each ported or adapted file:
  1. keep the original id Software copyright and licence header, unchanged;
  2. add a line `Modified for SEEK & STRIKE (<year>): <short description>` below it (Additional Terms §3: altered versions must be plainly marked and must not be presented as the original);
  3. add a row to the table below with the upstream file path;
  4. do not use the names Wolfenstein, Enemy Territory, id Software or Splash Damage to endorse or promote the product.
- The source release contains **no game data**. Original ET maps, textures, sounds, models and the game name remain under the original EULA and are **not** included and **not** licensed here.
- Additional Terms §4 (indemnification) applies only if you agree with a recipient to take on liability for the covered work. Do not offer warranties or support guarantees for the covered work in store listings or contracts without legal review.

| Ported/adapted file here | Upstream file | Changes |
| --- | --- | --- |
| `shared/src/sim/etMove.ts` | `src/game/bg_pmove.c` | `PM_ClipVelocity`, `PM_Friction` (ground case), `PM_Accelerate`, `PM_CmdScale` (axial scaling only), `PM_Sprint` translated to pure TypeScript functions; ET constants kept in `ET_PM` (reference units, converted with `units.ts`). Water, ladder, slick, knockback, dodge, spectator/noclip, AI friction, powerup and weapon-weight branches removed. `movement.ts` calls `applyFriction` and `accelerate`; `clipVelocity`, `cmdScale` and `stepSprintTime` are ported and tested but not wired in yet (the game keeps its own SI-tuned stamina model). |
| `shared/src/sim/etClasses.ts` | `src/game/bg_classes.c` | Class ids, per-team class table, class/weapon lookups, names, letters, text-to-class and class skill translated to TypeScript. 1940s weapon lists, character files and UI icon paths replaced by this game's weapon ids; Axis/Allies replaced by attackers/defenders. Not used by the match yet. |

Tests for both files: `shared/src/sim/etPort.test.ts`. Both ported files start with the unchanged id Software header followed by a "Modified for SEEK & STRIKE" block.

## Other code

| Component | Licence | Notes |
| --- | --- | --- |
| three 0.186.1 | MIT | rendering |
| @dimforge/rapier3d 0.21.0 | Apache-2.0 | physics; WASM inlined in the bundle |
| Claude-of-Duty spring (`shared/src/spring.ts`) | MIT | commit `d9b237b75c9304ab8d9ef4cfa0c3568c7c11a853`; text in `licenses/Claude-of-Duty-MIT.txt` |
| DevFridge skill helpers (`quality-governor.mjs`, `pass/vendor/*.mjs`) | per the skill | copied unmodified |
| npm dependencies | see `package-lock.json` | run a licence report before every release and add the result to the release manifest |

### Map pipeline: conventions and ideas reused (code rewritten, none copied)

`tools/map-pipeline/` follows conventions from the repositories below. The code was rewritten; no source file was copied. They are credited here as a courtesy and so the origin is on record. Evaluation: `docs/maps/repo-evaluation.md`.

| Repository | Commit | Licence | What was taken |
| --- | --- | --- | --- |
| https://github.com/danielsapps2/3dmap-creator | `374eb616a094d0eb263f36bba44eae42f696859f` | MIT | marker naming convention for spawns and objectives |
| https://github.com/djpav/threejs-tower-defense | `dcb33e163c96e03d464d868b5b91ca5af93fe4f2` | MIT | ideas only (grid/path structure) |
| https://github.com/samuelaidoo45/worldfolk | `ea08a784ed7c9457d98990d3014811c85cb1da0f` | Apache-2.0 (code); OSM data ODbL | OSM building-height and footprint heuristics, rewritten in JS |

Not used, nothing copied: NotBlox (its licence excludes crypto/blockchain projects, so it is forbidden here), HorrorGame, threejs-games.github.io and threejs-maplibre (no valid licence; read for inspiration only).

If any file from the MIT or Apache-2.0 repositories is ever copied, keep its licence text and copyright notice in `licenses/` and add a row to the ET-style table above or here.

## Data

- **OpenStreetMap** (Trieste Porto Vecchio map): © OpenStreetMap contributors, Open Database License 1.0. The generated GLB is a *Produced Work* and must show the credit "© OpenStreetMap contributors" in the in-game credits and on the map loading screen. `footprints.odbl.json` is a *Derived Database* and must be published under ODbL. See `docs/maps/examples/porto-vecchio-ts/ATTRIBUTION.md`.
- CC0 assets (Quaternius, ambientCG, Poly Haven) need no credit; credits are still given in-game as a courtesy.
- SIL OFL fonts (Saira Stencil One, Allerta Stencil): only converted outlines are used; licence texts in `art/logo/fonts/`.

## Open points before a commercial release

- Rights review of the AI-generated rifle model and of the logo rifle trace (`ASSETS_LICENSES.md`).
- Trademark search for "SEEK & STRIKE" (EUIPO/USPTO), dApp Store name and domain.
- Check that the store's terms allow distributing a GPL-3.0-or-later APK together with the source offer.
- Lawyer review of this file, `LICENSE.md` and the Additional Terms, in particular if Enemy Territory code is ported.
