# map-pipeline (Seek & Strike — offline map build, GPL-3.0-or-later)

Build-time tooling only — nothing here ships in the APK except the files it **outputs**.
Italian evaluation and Stage 3 plan: `../../docs/maps/repo-evaluation.md`.

```
npm install            # deps only (three, rapier3d-compat, gltf-transform, meshoptimizer, esbuild, playwright-core)
npm run all            # example GLB + build, OSM bake (from cache) + build
npm test               # round-trip / reachability checks
npm run preview        # headless Chrome (SwiftShader) PNGs  — visual QA only, NOT an FPS measurement
```

## 1. Authoring convention (GLB/glTF; Blender or 3dmap-creator)

Node **names** (case-insensitive, Blender `.001` suffixes ignored) or node `extras`
(3dmap-creator `userData`: `{ mapType, collider, marker, tags, props }`) — both are read.

| Name pattern | Meaning | Notes |
|---|---|---|
| `spawn_attack_<n>` / `spawn_defend_<n>` | team spawn | yaw from node rotation; yaw 0 = facing −Z |
| `objective_<id>` | bomb site / console | `extras.radius` optional |
| `cover_<id>` | designer cover hint | `extras.height: "low"|"high"` |
| `nav_<id>` | bot waypoint | graph edges auto-built (≤30 m, line walkable) |
| `trigger_<id>` | volume (scale = size) | not solid |
| `light_<id>` | point light hint | |
| any mesh | solid by default | `extras.collider`: `box` (default for box-like meshes) · `mesh` (trimesh) · `hull` · `none` · `trigger` |
| | sim material | `extras.material`: `concrete|metal|wood|glass|...`, `extras.look`, `extras.shell`, `extras.fill` → shared-sim `MapBox` |
| | approx. sim rects | `extras.simRects: [[cx,cy,cz,sx,sy,sz],…]` for non-AABB meshes (shared sim is AABB-only) |
| scene `extras` | map meta | `mapFormat, id, name, nameKey, bounds, waterLevel, environment{fog,sun}` |

## 2. `build-map.mjs in.glb --out dir [--cell 0.5]`

Outputs in `dir/`:
* `markers.json` — `seek-strike-markers` v1: spawns, objective, cover, nav + `waypointGraph`, bounds, env.
* `colliders.json` — Rapier descriptors (`cuboid` with rotation, `trimesh` base64 verts/indices, `convexHull`) **and**
  `simBoxes` (exact `MapBox` for axis-aligned boxes; `approx:true` for simRects) for the shared deterministic sim.
* `navgrid.json` — 0.5 m 2.5D grid baked with Rapier ray/shape casts: height (cm), flags
  (WALKABLE/REACHABLE/WATER/CROUCH/UPPER), cover-high/low bits, flood-filled from attack spawns.
  Runtime A* / snap: `src/lib/nav-runtime.mjs` (browser-safe, no deps) → copy to the client/bots.
* `render.glb` — markers stripped, dedup/flatten/join per material, weld, quantize, meshopt.
* `report.json` — counts, draw calls, triangles, validation (spawns/objective reachable, paths, lonely waypoints).
Exit code 1 if validation fails (use as CI gate).

## 3. `osm-bake.mjs maps/<cfg>.json [--offline]`

Offline OSM → GLB for a ~300 m district: Overpass (cached in `cache/`, never fetched at runtime) → local metres →
grid-aligned rotation → coastline land/sea → extruded buildings (OSM height / levels / defaults), roads/rails ribbons,
quay slabs, water, seeded containers/cover/spawns/objective/nav markers. Writes the GLB (with `asset.copyright`),
`<id>.footprints.json` (ODbL Derived Database) and `ATTRIBUTION.md`.
**ODbL**: credit "© OpenStreetMap contributors" in-game; publish footprints.json under ODbL. No tiles/styles are used.

## Provenance
Original code for this project. Ideas (not code) from: 3dmap-creator (MIT, userData schema), worldfolk (Apache-2.0,
OSM extract heuristics), threejs-tower-defense (MIT, seeded grid). **No code from NotBlox** (licence forbids crypto use).
