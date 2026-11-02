import { existsSync as existsSync } from 'node:fs';
// SPDX-License-Identifier: GPL-3.0-or-later
// Authoring example: rebuilds the stage-1 "Porto di Ardesia — Banchina Est" layout as a marker-annotated GLB,
// exactly as a level designer would author it in 3dmap-creator or Blender (one node per solid + named empties).
// Source layout is read (never modified) from ../../modern-war-2030/shared/src/map/portoArdesia.ts.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MapWriter, boxGeometry, yawQuat } from './lib/gltf-write.mjs';

const SRC = process.env.MAP_SRC ?? [new URL('../../../shared/src/map/portoArdesia.ts', import.meta.url).pathname, '/workspace/modern-war-2030/shared/src/map/portoArdesia.ts'].find((p) => existsSync(p));
const OUT = process.argv[2] ?? 'out/banchina-est.glb';
const bundled = await build({ entryPoints: [SRC], bundle: true, write: false, format: 'esm', platform: 'node' });
mkdirSync('out', { recursive: true });
const tmp = new URL('../out/_map_src.mjs', import.meta.url);
writeFileSync(tmp, bundled.outputFiles[0].text);
const mod = await import(tmp.href + '?t=' + Date.now());
const def = Object.values(mod).find((v) => v && Array.isArray(v.boxes));
const ENV = def.environment ?? { sun: { azimuthDeg: 110, elevationDeg: 14 }, fog: { color: '#b9c4cc', near: 60, far: 220 }, timeOfDay: 'dawn' };

const b = def.bounds;
const w = new MapWriter(def.id, {
  id: def.id, nameKey: def.nameKey, bounds: b, waterLevel: def.waterLevel,
  environment: ENV,
  source: SRC.split(/[\/]/).pop(),
});

// Ground slab (quay apron) and the sea beyond the east kerb.
const gx = b.maxX - b.minX + 4, gz = b.maxZ - b.minZ + 4;
w.mesh('ground_quay', boxGeometry(gx, 0.5, gz, 4), 'quayStone', {
  translation: [(b.minX + b.maxX) / 2, -0.25, (b.minZ + b.maxZ) / 2],
  extras: { collider: 'box', material: 'concrete', role: 'ground' },
});
w.mesh('water_sea', boxGeometry(80, 0.02, gz + 40, 8), 'water', {
  translation: [b.maxX + 42, def.waterLevel, 0], extras: { collider: 'none', role: 'water' },
});

const lookToMat = (l) => l; // palette keys match BoxLook names
def.boxes.forEach((box, i) => {
  // Buildings become `bld_…` nodes with a plaster/brick material: the client compiles them into procedural architecture.
  const node = box.building ? `bld_${String(i).padStart(3, '0')}_${box.building}` : `blk_${box.look}_${String(i).padStart(2, '0')}`;
  w.mesh(node, boxGeometry(box.s.x, box.s.y, box.s.z), box.building ?? lookToMat(box.look), {
    translation: [box.c.x, box.c.y, box.c.z],
    extras: { collider: 'box', static: true, material: box.material, look: box.look,
      ...(box.shell !== undefined ? { shell: box.shell } : {}), ...(box.fill !== undefined ? { fill: box.fill } : {}) },
  });
});

// Markers: named empties (pipeline convention) + 3dmap-creator-compatible extras ({marker, tags}).
const teams = ['attack', 'defend'];
def.spawns.forEach((list, t) => list.forEach((p, i) => w.empty(`spawn_${teams[t]}_${i}`, {
  translation: [p.x, 0, p.z], rotation: yawQuat(def.spawnYaw[t]),
  extras: { marker: 'spawn', tags: [teams[t]], props: { team: t } },
})));
w.empty('objective_charge_console', {
  translation: [def.objective.x, def.objective.y, def.objective.z],
  extras: { marker: 'objective', tags: ['plant', 'defuse'], props: { kind: 'plant', radius: 1.6, fuseSeconds: 30 } },
});
def.waypoints.forEach((p, i) => w.empty(`nav_${String(i).padStart(2, '0')}`, {
  translation: [p.x, 0, p.z],
  extras: { marker: 'waypoint', props: { patrols: def.patrols.map((loop, li) => (loop.includes(i) ? li : -1)).filter((x) => x >= 0) } },
}));
// Cover markers: one each side of every jersey barrier / crate (designer hints for bot AI).
let ci = 0;
for (const box of def.boxes) {
  if (box.look !== 'barrier' || box.s.y > 1.2) continue;
  const alongX = box.s.x > box.s.z;
  for (const s of [-1, 1]) {
    const off = (alongX ? box.s.z : box.s.x) / 2 + 0.45;
    w.empty(`cover_${String(ci++).padStart(2, '0')}`, {
      translation: [box.c.x + (alongX ? 0 : s * off), 0, box.c.z + (alongX ? s * off : 0)],
      extras: { marker: 'cover', props: { height: box.s.y, stance: 'crouch', facing: alongX ? [0, -s] : [-s, 0] } },
    });
  }
}
w.root.setExtras({ ...w.root.getExtras(), patrols: def.patrols });
await w.write(OUT);
console.log(`wrote ${OUT}: ${def.boxes.length} solids, ${def.spawns[0].length + def.spawns[1].length} spawns, ${def.waypoints.length} nav, ${ci} cover`);
