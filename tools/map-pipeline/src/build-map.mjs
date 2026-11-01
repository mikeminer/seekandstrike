#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// SEEK & STRIKE map build: GLB (3dmap-creator / Blender / osm-bake) with marker nodes ->
//   <out>/markers.json    spawns, objectives, cover, nav waypoints (+ waypoint graph), triggers
//   <out>/colliders.json  simplified static Rapier colliders + shared-sim AABBs (MapBox-compatible)
//   <out>/navgrid.json    bot nav grid (walk/crouch/reach/water bits, heights, cover bits)
//   <out>/render.glb      runtime mesh: markers stripped, joined per material, meshopt-compressed
//   <out>/report.json     budgets + validation
// Usage: node src/build-map.mjs map.glb --out out/name [--cell 0.5] [--no-render]
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { dedup, flatten, join, meshopt, prune, weld as weldFn, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { makeIO } from './lib/gltf-write.mjs';
import { classifyMarker, summarize } from './lib/markers.mjs';
import { buildColliders, addToWorld } from './lib/colliders.mjs';
import { bakeNav, encodeGrid } from './lib/navbake.mjs';
import { fromB64, decodeGrid, findPath, snap, walkLine, REACHABLE } from './lib/nav-runtime.mjs';

const args = process.argv.slice(2);
const input = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = opt('--out', 'out/map');
const cell = Number(opt('--cell', '0.5'));
if (!input) { console.error('usage: build-map.mjs map.glb --out dir'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const t0 = performance.now();

const io = makeIO();
const doc = await io.read(input);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
// Map root extras: our writer puts them on the first node; 3dmap-creator (three GLTFExporter) puts them on the scene.
const rootNode = scene.listChildren()[0];
const rootExtras = { ...(scene.getExtras() ?? {}), ...(rootNode?.getExtras()?.mapFormat ? rootNode.getExtras() : {}) };

const markers = [], meshes = [], markerNodes = [];
scene.traverse((node) => {
  const world = node.getWorldMatrix();
  const mk = node.getMesh() ? null : classifyMarker(node, world);
  if (mk) { markers.push(mk); markerNodes.push(node); return; }
  if (node.getMesh()) meshes.push({ node, world });
});

const col = await buildColliders(meshes);
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const nCol = addToWorld(RAPIER, world, col);
world.step();

// Bounds: explicit map bounds, else XZ extent of colliders (cuboids/trimesh) + 2 m.
let bounds = rootExtras.bounds;
if (!bounds) {
  const xs = [], zs = [];
  for (const b of col.cuboids) { xs.push(b.c[0] - b.h[0], b.c[0] + b.h[0]); zs.push(b.c[2] - b.h[2], b.c[2] + b.h[2]); }
  for (const t of col.trimeshes) { const v = new Float32Array(fromB64(t.v).buffer); for (let i = 0; i < v.length; i += 3) { xs.push(v[i]); zs.push(v[i + 2]); } }
  bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
const waterLevel = rootExtras.waterLevel ?? -Infinity;
const spawnsA = markers.filter((m) => m.kind === 'spawn' && m.team === 0);
const nav = bakeNav(RAPIER, world, { bounds, cell, waterLevel, seeds: spawnsA.map((m) => m.position) });
const navJson = encodeGrid(nav.g, nav.upper);
const g = decodeGrid(navJson);

// Validation: every spawn/objective must be on reachable ground; path attack spawn -> objective -> defend spawn.
const validation = [];
const reachable = (p) => { const c = snap(g, p[0], p[2], 8, p[1]); return !!c && (g.flags[c[1] * g.w + c[0]] & REACHABLE) !== 0; };
for (const m of markers.filter((m) => m.kind === 'spawn' || m.kind === 'objective')) if (!reachable(m.position)) validation.push(`unreachable ${m.name} @ ${m.position}`);
const obj = markers.find((m) => m.kind === 'objective');
const paths = {};
if (spawnsA[0] && obj) { const p = findPath(g, spawnsA[0].position, obj.position); paths.attackToObjective = p ? { length: +p.length.toFixed(1), corners: p.points.length } : null; if (!p) validation.push('no path attack spawn -> objective'); }
const spawnD = markers.find((m) => m.kind === 'spawn' && m.team === 1);
if (spawnD && obj) { const p = findPath(g, spawnD.position, obj.position); paths.defendToObjective = p ? { length: +p.length.toFixed(1), corners: p.points.length } : null; if (!p) validation.push('no path defend spawn -> objective'); }
if (spawnsA[0] && obj) { const p = findPath(g, spawnsA[0].position, obj.position, { exposure: 0.6 }); paths.attackToObjectiveCovered = p ? { length: +p.length.toFixed(1), corners: p.points.length } : null; }

// Waypoint graph: link nav_* markers that have a straight walkable line (<= 30 m).
const navM = markers.filter((m) => m.kind === 'nav');
const edges = [];
for (let i = 0; i < navM.length; i++) for (let j = i + 1; j < navM.length; j++) {
  const a = navM[i].position, b = navM[j].position;
  const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
  if (d > 30) continue;
  const ca = snap(g, a[0], a[2], 8, a[1]), cb = snap(g, b[0], b[2], 8, b[1]);
  if (ca && cb && walkLine(g, ca[0], ca[1], cb[0], cb[1])) edges.push([i, j, +d.toFixed(2)]);
}
const lonely = navM.filter((_, i) => !edges.some((e) => e[0] === i || e[1] === i)).map((m) => m.name);
if (lonely.length) validation.push(`${lonely.length} nav waypoints without a straight walkable link: ${lonely.slice(0, 6).join(', ')}${lonely.length > 6 ? '…' : ''}`);

const sum = summarize(markers);
writeFileSync(`${outDir}/markers.json`, JSON.stringify({ format: 'seek-strike-markers', version: 1, map: rootExtras.name ?? rootNode?.getName(), id: rootExtras.id, bounds, waterLevel: Number.isFinite(waterLevel) ? waterLevel : null, environment: rootExtras.environment ?? null, patrols: rootExtras.patrols ?? null, counts: sum.counts, markers, waypointGraph: { nodes: navM.map((m) => m.name), edges } }, null, 1));
writeFileSync(`${outDir}/colliders.json`, JSON.stringify({ format: 'seek-strike-colliders', version: 1, units: 'm', note: 'cuboid h = half extents, q = [x,y,z,w]; v/i = base64 Float32/Uint32 (world space); simBoxes are MapBox-compatible AABBs for shared/src/map', ...col }));
writeFileSync(`${outDir}/navgrid.json`, JSON.stringify(navJson));

// Runtime render GLB: strip markers, flatten hierarchy, join by material, weld, quantize, meshopt.
let render = null;
if (!args.includes('--no-render')) {
  for (const n of markerNodes) n.dispose();
  await MeshoptEncoder.ready;
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weldFn(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${outDir}/render.glb`, doc);
  let draws = 0, tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { draws++; tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; }
  render = { file: 'render.glb', bytes: statSync(`${outDir}/render.glb`).size, drawCalls: draws, triangles: tris, materials: doc.getRoot().listMaterials().map((m) => m.getName()) };
}

const report = {
  input, builtAt: new Date().toISOString(), ms: Math.round(performance.now() - t0),
  markers: sum.counts, markerIssues: sum.issues,
  colliders: { rapierColliders: nCol, cuboids: col.cuboids.length, convex: col.convex.length, trimeshes: col.trimeshes.length, heightfieldsAsTrimesh: col.heightfields.length, sensors: col.sensors.length, simBoxes: col.simBoxes.length, simApproxBoxes: col.simBoxes.filter((b) => b.approx).length, notSimRepresentable: col.cuboids.length - col.simBoxes.filter((b) => !b.approx).length + col.convex.length + col.trimeshes.filter((t) => !t.simRects).length, sourceTriangles: col.stats.trisIn, colliderTriangles: col.stats.trisOut },
  nav: nav.stats, paths, waypointEdges: edges.length, validation, render,
};
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (validation.length || sum.issues.length) process.exitCode = 1;
