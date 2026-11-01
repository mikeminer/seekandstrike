#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Offline OSM -> GLB baker for a small port district. Run on a dev box ONCE; the game ships only the baked GLB
// (no tile servers, no runtime network). Data © OpenStreetMap contributors, ODbL 1.0 — see ATTRIBUTION.md it writes.
//   node src/osm-bake.mjs maps/trieste-porto-vecchio.json [--offline] [--out out/porto-vecchio]
// Output: <out>.glb (marker-annotated, ready for build-map.mjs), <out>.footprints.json (derived DB, ODbL), ATTRIBUTION.md
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ShapeUtils, Vector2 } from 'three';
import { MapWriter, boxGeometry, yawQuat } from './lib/gltf-write.mjs';

const cfgPath = process.argv[2] ?? 'maps/trieste-porto-vecchio.json';
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? process.argv[argOut + 1] : `out/${cfg.id}`;
mkdirSync(dirname(OUT), { recursive: true });
mkdirSync('cache', { recursive: true });

// ---------- seeded RNG (mulberry32) ----------
let seed = cfg.seed >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- fetch (cached) ----------
const [lat0, lon0] = cfg.center;
const [W, D] = cfg.size;
const R = 6378137, DEG = Math.PI / 180;
const mLat = R * DEG, mLon = R * DEG * Math.cos(lat0 * DEG);
const margin = 60;
const bbox = [lat0 - (D / 2 + margin) / mLat, lon0 - (W / 2 + margin) / mLon, lat0 + (D / 2 + margin) / mLat, lon0 + (W / 2 + margin) / mLon].map((v) => +v.toFixed(6));
const cacheFile = `cache/${cfg.id}.overpass.json`;
const query = `[out:json][timeout:90];(way["building"](${bbox});relation["building"](${bbox});way["highway"](${bbox});way["railway"](${bbox});way["natural"="coastline"](${bbox});way["man_made"~"pier|breakwater"](${bbox});way["natural"="water"](${bbox}););out geom;`;
let osm;
if (existsSync(cacheFile)) osm = JSON.parse(readFileSync(cacheFile, 'utf8'));
else {
  if (process.argv.includes('--offline')) throw new Error(`no cache ${cacheFile}`);
  for (const url of cfg.overpass) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'SeekStrike-map-pipeline/0.1 (offline bake)' }, signal: AbortSignal.timeout(150000) });
      if (!res.ok) { console.error(url, res.status); continue; }
      osm = await res.json();
      osm.fetched = { url, at: new Date().toISOString(), bbox, query };
      writeFileSync(cacheFile, JSON.stringify(osm));
      break;
    } catch (e) { console.error(url, e.message); }
  }
  if (!osm) throw new Error('Overpass unavailable; retry later');
}
const osmBase = osm.osm3s?.timestamp_osm_base ?? osm.fetched?.at;

// ---------- projection + grid alignment ----------
const proj = (p) => [(p.lon - lon0) * mLon, -(p.lat - lat0) * mLat];
const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry);
const bldWays = ways.filter((e) => e.tags?.building);
// relations (multipolygon buildings): take outer rings only
for (const r of osm.elements.filter((e) => e.type === 'relation' && e.tags?.building)) for (const m of r.members ?? []) if (m.role === 'outer' && m.geometry) bldWays.push({ id: `r${r.id}`, tags: r.tags, geometry: m.geometry });

// Dominant orientation (length-weighted histogram of building edges mod 90°) -> rotate so the district is axis-aligned.
let rot = 0;
if (cfg.alignToGrid) {
  const hist = new Float64Array(90);
  for (const b of bldWays) { const pts = b.geometry.map(proj); for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1]; const L = Math.hypot(dx, dz); let a = Math.atan2(dz, dx) / DEG; a = ((a % 90) + 90) % 90; hist[Math.round(a) % 90] += L; } }
  let best = 0; for (let a = 0; a < 90; a++) { const s = hist[a] + 0.5 * (hist[(a + 1) % 90] + hist[(a + 89) % 90]); if (s > best) { best = s; rot = a; } }
  if (rot > 45) rot -= 90;
  rot *= DEG;
}
const cr = Math.cos(-rot), sr = Math.sin(-rot);
const P = (p) => { const [x, z] = proj(p); return [x * cr - z * sr, x * sr + z * cr]; };
const HX = W / 2, HZ = D / 2;

// ---------- geometry helpers ----------
const area = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return a / 2; };
function dp(pts, eps) { // Douglas-Peucker on an open polyline
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L; if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)] : [a, b];
}
function clipRect(poly, x0, z0, x1, z1) { // Sutherland–Hodgman
  const edges = [[(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z0]; }],
    [(p) => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), z1]; }]];
  let out = poly;
  for (const [inside, cut] of edges) { const inp = out; out = []; for (let i = 0; i < inp.length; i++) { const c = inp[i], p = inp[(i + inp.length - 1) % inp.length]; if (inside(c)) { if (!inside(p)) out.push(cut(p, c)); out.push(c); } else if (inside(p)) out.push(cut(p, c)); } if (!out.length) break; }
  return out;
}
const pip = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > z) !== (pts[j][1] > z) && x < (pts[j][0] - pts[i][0]) * (z - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c; return c; };

/** Extruded prism: walls (UV in metres, 3 m texel tiling ready) + flat roof cap. Footprint CCW in x/z-up view. */
function extrude(poly, y0, y1) {
  const pos = [], nor = [], uv = [], idx = [];
  const n = poly.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue;
    // outward normal for a CW-in-screen (CCW when z is "down") ring — fixed below by winding check
    const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    const base = pos.length / 3;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uv.push(u, y0, u + L, y0, u + L, y1, u, y1); u += L;
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const tris = ShapeUtils.triangulateShape(poly.map((p) => new Vector2(p[0], p[1])), []);
  const base = pos.length / 3;
  for (const p of poly) { pos.push(p[0], y1, p[1]); nor.push(0, 1, 0); uv.push(p[0], p[1]); }
  for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), uv: Float32Array.from(uv), index: idx };
}
function ribbon(line, width, y) {
  const pos = [], nor = [], uv = [], idx = []; let v = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i], a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz * width / 2, nz = dx * width / 2;
    if (i) v += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz); nor.push(0, 1, 0, 0, 1, 0); uv.push(0, v, width, v);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), uv: Float32Array.from(uv), index: idx };
}
function mergeGeo(list) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g of list) { pos.push(...g.position); nor.push(...g.normal); uv.push(...g.uv); for (const i of g.index) idx.push(i + off); off += g.position.length / 3; }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nor), uv: Float32Array.from(uv), index: idx };
}
// Fix winding so wall normals point outwards whatever the source ring orientation.
const orient = (poly) => (area(poly) > 0 ? poly : poly.slice().reverse());

// ---------- land / sea mask (1 m raster) ----------
const G = 1, gw = Math.ceil(W / G), gd = Math.ceil(D / G);
const LAND = 1, SEA = 2, BLD = 4, ROAD = 8, OCC = 16;
const mask = new Uint8Array(gw * gd);
const cellIdx = (x, z) => { const i = Math.floor((x + HX) / G), j = Math.floor((z + HZ) / G); return i >= 0 && j >= 0 && i < gw && j < gd ? j * gw + i : -1; };
const coast = ways.filter((e) => e.tags?.natural === 'coastline').map((e) => e.geometry.map(P));
const barrier = new Uint8Array(gw * gd);
// Side test against the NEAREST coastline segment (robust when the coastline only partly crosses the window,
// where a flood fill would leak). OSM rule: land on the LEFT, sea on the RIGHT of the way direction in lon/lat.
// With x = east, z = -north the right-hand vector of a direction (dx, dz) is (-dz, dx).
const segs = [];
for (const line of coast) for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i]]);
if (segs.length) for (let j = 0; j < gd; j++) for (let i = 0; i < gw; i++) {
  const x = -HX + (i + 0.5) * G, z = -HZ + (j + 0.5) * G;
  let bd = Infinity, side = 0, interior = -1;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    const px = a[0] + t * dx - x, pz = a[1] + t * dz - z, d = px * px + pz * pz;
    const tin = Math.min(t, 1 - t); // prefer the segment we project inside of when distances tie at a vertex
    if (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && tin > interior)) { bd = d; interior = tin; side = (x - a[0]) * -dz + (z - a[1]) * dx; }
  }
  if (bd < (G * 0.75) ** 2) barrier[j * gw + i] = 1;
  if (side > 0) mask[j * gw + i] |= SEA;
}
// barrier cells next to sea count as sea edge; everything else land. Piers/breakwaters force land.
for (let k = 0; k < mask.length; k++) if (!(mask[k] & SEA)) mask[k] |= LAND;
for (const e of ways.filter((e) => /pier|breakwater/.test(e.tags?.man_made ?? ''))) {
  const pts = e.geometry.map(P); const closed = e.geometry.length > 3 && e.geometry[0].lat === e.geometry.at(-1).lat && e.geometry[0].lon === e.geometry.at(-1).lon;
  for (let j = 0; j < gd; j++) for (let i = 0; i < gw; i++) { const x = -HX + (i + 0.5) * G, z = -HZ + (j + 0.5) * G; if (closed && pip(pts, x, z)) mask[j * gw + i] = LAND; }
}
const seaFrac = mask.reduce((s, m) => s + (m & SEA ? 1 : 0), 0) / mask.length;
if (seaFrac > 0.97) { console.warn('coastline flood leaked: treating all as land'); mask.fill(LAND); }

// ---------- buildings ----------
const DH = cfg.defaultHeights;
const parseH = (t) => { const h = parseFloat(t.height ?? t['building:height']); if (Number.isFinite(h)) return h; const l = parseFloat(t['building:levels']); if (Number.isFinite(l)) return l * 3.2 + 0.8; return DH[t.building] ?? DH.default; };
const buildings = [];
for (const b of bldWays) {
  let poly = b.geometry.map(P);
  if (poly.length > 1 && poly[0][0] === poly.at(-1)[0] && poly[0][1] === poly.at(-1)[1]) poly.pop();
  poly = clipRect(poly, -HX + 1, -HZ + 1, HX - 1, HZ - 1);
  if (poly.length < 3) continue;
  { // closed-ring Douglas-Peucker: split at the vertex farthest from vertex 0
    let far = 0, fd = -1; poly.forEach((p, k) => { const d = Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]); if (d > fd) { fd = d; far = k; } });
    poly = [...dp(poly.slice(0, far + 1), 0.3).slice(0, -1), ...dp([...poly.slice(far), poly[0]], 0.3).slice(0, -1)];
  }
  if (poly.length < 3 || Math.abs(area(poly)) < 6) continue;
  poly = orient(poly);
  const h = Math.min(40, Math.max(2.5, parseH(b.tags)));
  // rectangularity vs AABB (after grid alignment) -> cheap box collider + shared-sim AABB
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const aabb = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  const rect = Math.abs(area(poly)) / aabb;
  buildings.push({ id: String(b.id), tags: b.tags, poly, h, rect });
  for (let j = 0; j < gd; j++) for (let i = 0; i < gw; i++) { const x = -HX + (i + 0.5) * G, z = -HZ + (j + 0.5) * G; if (x < Math.min(...xs) - 1 || x > Math.max(...xs) + 1 || z < Math.min(...zs) - 1 || z > Math.max(...zs) + 1) continue; if (pip(poly, x, z)) mask[j * gw + i] |= BLD; }
}

// ---------- roads / rails ----------
const ROADW = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6.5, residential: 6, unclassified: 6, living_street: 5, service: 4.5, pedestrian: 4, footway: 2, cycleway: 2, path: 1.6, steps: 2 };
const roadGeo = [], railGeo = [];
for (const e of ways) {
  const hw = e.tags?.highway, rw = e.tags?.railway;
  if (!hw && !rw) continue;
  if (e.tags?.area === 'yes' || e.tags?.tunnel === 'yes' || e.tags?.layer > 0) continue;
  let line = e.geometry.map(P).filter((p) => Math.abs(p[0]) < HX + 5 && Math.abs(p[1]) < HZ + 5);
  if (line.length < 2) continue;
  line = dp(line, 0.25);
  if (hw && ROADW[hw]) {
    roadGeo.push(ribbon(line, ROADW[hw], 0.02 + (ROADW[hw] > 3 ? 0 : 0.005)));
    for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; const r = ROADW[hw] / 2; for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const c = cellIdx(x + dx, z + dz); if (c >= 0) mask[c] |= ROAD; } } }
  } else if (rw === 'rail' || rw === 'disused' || rw === 'abandoned' || rw === 'tram') railGeo.push(ribbon(line, 1.6, 0.03));
}

// ---------- write GLB ----------
const bounds = { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ };
const attribution = '© OpenStreetMap contributors (ODbL 1.0) — https://www.openstreetmap.org/copyright';
const w = new MapWriter(cfg.name, {
  id: cfg.id, nameKey: cfg.nameKey, bounds, waterLevel: cfg.waterLevel, attribution,
  source: { osm: true, center: cfg.center, sizeM: cfg.size, rotationDeg: +(rot / DEG).toFixed(2), osmBase },
  environment: { sun: { azimuthDeg: 235, elevationDeg: 22 }, fog: { color: '#c3c9cc', near: 80, far: 320 }, timeOfDay: 'late-afternoon' },
});
w.doc.getRoot().getAsset().copyright = attribution;

// Land slabs: greedy rectangles over the LAND mask at 2 m (few boxes -> cheap colliders + shared-sim AABBs).
const LG = 2, lw = Math.ceil(W / LG), ld = Math.ceil(D / LG);
const land = new Uint8Array(lw * ld);
for (let j = 0; j < ld; j++) for (let i = 0; i < lw; i++) { let n = 0, s = 0; for (let b = 0; b < LG; b++) for (let a = 0; a < LG; a++) { const k = (j * LG + b) * gw + i * LG + a; if (j * LG + b < gd && i * LG + a < gw) { n++; if (mask[k] & LAND) s++; } } land[j * lw + i] = s * 2 >= n ? 1 : 0; }
let slabs = 0;
for (let j = 0; j < ld; j++) for (let i = 0; i < lw; i++) {
  if (!land[j * lw + i]) continue;
  let i1 = i; while (i1 + 1 < lw && land[j * lw + i1 + 1]) i1++;
  let j1 = j; outer: while (j1 + 1 < ld) { for (let a = i; a <= i1; a++) if (!land[(j1 + 1) * lw + a]) break outer; j1++; }
  for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) land[b * lw + a] = 0;
  const sx = (i1 - i + 1) * LG, sz = (j1 - j + 1) * LG;
  w.mesh(`ground_land_${slabs++}`, boxGeometry(sx, 6, sz, 4), 'quayStone', { translation: [-HX + i * LG + sx / 2, -3, -HZ + j * LG + sz / 2], extras: { collider: 'box', material: 'concrete', role: 'ground' } });
}
w.mesh('seabed', boxGeometry(W + 40, 1, D + 40, 8), 'concreteDark', { translation: [0, -6.5, 0], extras: { collider: 'box', material: 'concrete', role: 'seabed' } });
if (seaFrac > 0.005) w.mesh('water_sea', boxGeometry(W + 40, 0.02, D + 40, 8), 'water', { translation: [0, cfg.waterLevel, 0], extras: { collider: 'none', role: 'water' } });
if (roadGeo.length) w.mesh('roads', mergeGeo(roadGeo), 'asphalt', { extras: { collider: 'none', role: 'decal' } });
if (railGeo.length) w.mesh('rails', mergeGeo(railGeo), 'rail', { extras: { collider: 'none', role: 'decal' } });

// Shared-sim approximation for non-rectangular footprints: greedy axis-aligned rectangles over a 1 m raster
// (cell centre inside polygon). The server sim (AABB-only today) uses these; Rapier uses the exact trimesh.
function simRects(poly, h) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)), z0 = Math.floor(Math.min(...zs));
  const nx = Math.ceil(Math.max(...xs)) - x0, nz = Math.ceil(Math.max(...zs)) - z0;
  const r = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) r[j * nx + i] = pip(poly, x0 + i + 0.5, z0 + j + 0.5) ? 1 : 0;
  const out = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!r[j * nx + i]) continue;
    let i1 = i; while (i1 + 1 < nx && r[j * nx + i1 + 1]) i1++;
    let j1 = j; outer: while (j1 + 1 < nz) { for (let a = i; a <= i1; a++) if (!r[(j1 + 1) * nx + a]) break outer; j1++; }
    for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) r[b * nx + a] = 0;
    out.push([x0 + (i + i1 + 1) / 2, h / 2, z0 + (j + j1 + 1) / 2, i1 - i + 1, h, j1 - j + 1]);
  }
  return out;
}
const footprints = [];
let nBoxCol = 0;
buildings.forEach((b, i) => {
  const isRect = b.rect > 0.93;
  const mat = /industrial|warehouse|hangar/.test(b.tags.building) ? 'brick' : 'plaster';
  const g = extrude(b.poly, -0.2, b.h);
  if (isRect) nBoxCol++;
  w.mesh(`bld_${String(i).padStart(3, '0')}_${(b.tags.name ?? b.tags.building).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24)}`, g, mat, {
    extras: { collider: isRect ? 'box' : 'mesh', ...(isRect ? {} : { simRects: simRects(b.poly, b.h) }), material: 'concrete', look: 'concrete', shell: false, osm: { id: b.id, building: b.tags.building, name: b.tags.name ?? null }, heightSource: b.tags.height ? 'height' : b.tags['building:levels'] ? 'levels' : 'default' },
  });
  footprints.push({ osmId: b.id, building: b.tags.building, name: b.tags.name ?? null, height: +b.h.toFixed(2), footprint: b.poly.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]) });
});

// ---------- procedural gameplay dressing (seeded) ----------
const free = (x, z, r) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const c = cellIdx(x + dx, z + dz); if (c < 0) return false; const m = mask[c]; if (!(m & LAND) || (m & (BLD | OCC))) return false; } return true; };
const occupy = (x, z, hx, hz) => { for (let dz = -hz; dz <= hz; dz++) for (let dx = -hx; dx <= hx; dx++) { const c = cellIdx(x + dx, z + dz); if (c >= 0) mask[c] |= OCC; } };
const nearestFree = (x, z, r, maxR = 60) => { for (let s = 0; s <= maxR; s += 1) for (let k = 0; k < Math.max(1, s * 8); k++) { const a = (k / Math.max(1, s * 8)) * Math.PI * 2; const px = x + Math.cos(a) * s, pz = z + Math.sin(a) * s; if (free(px, pz, r)) return [Math.round(px * 2) / 2, Math.round(pz * 2) / 2]; } return null; };

const longAxisZ = D >= W;
const ax = (u, v) => (longAxisZ ? [u, v] : [v, u]);
const halfLong = (longAxisZ ? HZ : HX) - 14;
const atkC = nearestFree(...ax(0, halfLong), 4), defC = nearestFree(...ax(0, -halfLong), 4);
const objC = nearestFree(0, 0, 3);
if (process.env.DEBUG_MASK) { for (let j = 0; j < gd; j += 6) { let s = ''; for (let i = 0; i < gw; i += 3) { const m = mask[j * gw + i]; s += m & BLD ? '#' : m & SEA ? '~' : barrier[j * gw + i] ? 'C' : m & ROAD ? '=' : '.'; } console.log(s); } console.log({ seaFrac, rot: rot / DEG, atkC, defC, objC }); }
if (!atkC || !defC || !objC) throw new Error('could not place spawns/objective on free land');
const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));
const spawnOffsets = [[0, 0], [-2.5, 0], [2.5, 0], [-1.25, 2.5], [1.25, 2.5], [0, -2.5]];
const placeSpawns = (c, team) => spawnOffsets.map(([dx, dz], i) => {
  const p = nearestFree(c[0] + dx, c[1] + dz, 1, 12);
  occupy(p[0], p[1], 1, 1);
  w.empty(`spawn_${team === 0 ? 'attack' : 'defend'}_${i}`, { translation: [p[0], 0, p[1]], rotation: yawQuat(yawTo(p, objC)), extras: { marker: 'spawn', tags: [team === 0 ? 'attack' : 'defend'], props: { team } } });
  return p;
});
occupy(objC[0], objC[1], 3, 3);
const spA = placeSpawns(atkC, 0), spD = placeSpawns(defC, 1);
// Objective: a console against a steel plate, charge point in front of it.
w.mesh('obj_console', boxGeometry(1.6, 1.1, 0.8, 1), 'steelPlate', { translation: [objC[0], 0.55, objC[1] - 0.5], extras: { collider: 'box', material: 'metal', look: 'steelPlate', shell: true } });
w.empty('objective_charge_console', { translation: [objC[0], 1.1, objC[1] + 0.1], extras: { marker: 'objective', tags: ['plant', 'defuse'], props: { kind: 'plant', radius: 1.6, fuseSeconds: 30 } } });

// Containers (20/40 ft, stacked 1-2), crates and jersey barriers with cover markers.
const looks = ['containerRed', 'containerBlue', 'containerGrey'];
let nCont = 0, nCover = 0, nBar = 0, tries = 0;
const keepOut = [...spA, ...spD, objC];
const farFromKeep = (x, z, d) => keepOut.every((p) => Math.hypot(p[0] - x, p[1] - z) > d);
while (nCont < cfg.containers && tries++ < 4000) {
  const x = (rnd() * 2 - 1) * (HX - 8), z = (rnd() * 2 - 1) * (HZ - 8);
  const along = rnd() < 0.5; const len = rnd() < 0.6 ? 6.1 : 12.2;
  const [sx, sz] = along ? [len, 2.44] : [2.44, len];
  if (!farFromKeep(x, z, 10)) continue;
  const c = cellIdx(x, z); if (c < 0 || mask[c] & ROAD) continue;
  if (!free(x, z, Math.ceil(Math.max(sx, sz) / 2) + 2)) continue;
  occupy(x, z, Math.ceil(sx / 2), Math.ceil(sz / 2));
  const stack = rnd() < 0.35 ? 2 : 1, look = looks[(rnd() * 3) | 0];
  for (let s = 0; s < stack; s++) w.mesh(`blk_${look}_${String(nCont).padStart(2, '0')}_${s}`, boxGeometry(sx, 2.59, sz, 2), look, { translation: [x, 1.295 + s * 2.59, z], extras: { collider: 'box', material: 'sheetMetal', look, shell: true, fill: 'empty' } });
  // cover markers on both long sides
  for (const sgn of [-1, 1]) { const [cx, cz] = along ? [x, z + sgn * (sz / 2 + 0.6)] : [x + sgn * (sx / 2 + 0.6), z]; w.empty(`cover_${String(nCover++).padStart(2, '0')}`, { translation: [cx, 0, cz], extras: { marker: 'cover', props: { height: 'high', against: `container_${nCont}` } } }); }
  nCont++;
}
// Barriers around the objective (low cover) — 4 jersey barriers on a ring.
for (let k = 0; k < 6; k++) {
  const a = (k / 6) * Math.PI * 2 + 0.3; const p = nearestFree(objC[0] + Math.cos(a) * 7, objC[1] + Math.sin(a) * 7, 1, 6); if (!p) continue;
  occupy(p[0], p[1], 2, 1);
  const alongX = Math.abs(Math.cos(a)) < 0.7;
  w.mesh(`blk_barrier_${nBar++}`, boxGeometry(alongX ? 3 : 0.6, 1.0, alongX ? 0.6 : 3, 1), 'barrier', { translation: [p[0], 0.5, p[1]], extras: { collider: 'box', material: 'concrete', look: 'barrier' } });
  const out = [p[0] + Math.cos(a) * 0.9, p[1] + Math.sin(a) * 0.9];
  w.empty(`cover_${String(nCover++).padStart(2, '0')}`, { translation: [out[0], 0, out[1]], extras: { marker: 'cover', props: { height: 'low' } } });
}
// Nav waypoints: every ~18 m on free land (bots refine with the nav grid).
let nNav = 0;
for (let z = -HZ + 10; z <= HZ - 10; z += 18) for (let x = -HX + 10; x <= HX - 10; x += 18) { const p = nearestFree(x, z, 1, 5); if (p) w.empty(`nav_${String(nNav++).padStart(3, '0')}`, { translation: [p[0], 0, p[1]], extras: { marker: 'waypoint' } }); }

await w.write(`${OUT}.glb`);
writeFileSync(`${OUT}.footprints.json`, JSON.stringify({ license: 'ODbL-1.0', attribution, note: 'Derived database: OSM building footprints projected to local metres (x east, z south) and rotated by source.rotationDeg. Must be shared under ODbL if distributed.', source: { center: cfg.center, sizeM: cfg.size, bbox, rotationDeg: +(rot / DEG).toFixed(2), osmBase, query }, buildings: footprints }));
writeFileSync(`${dirname(OUT)}/ATTRIBUTION.md`, `# Attribution — ${cfg.name}\n\nMap geometry (building footprints, heights, coastline, roads and rails) derived from OpenStreetMap data.\n\n**© OpenStreetMap contributors** — data available under the Open Database License (ODbL 1.0): https://www.openstreetmap.org/copyright\n\n- Area: center ${cfg.center.join(', ')}, ${W}×${D} m, bbox ${bbox.join(', ')}\n- OSM snapshot: ${osmBase}\n- The GLB is a *Produced Work*: show "© OpenStreetMap contributors" in the game credits / map loading screen.\n- \`${cfg.id}.footprints.json\` is a *Derived Database* and is offered under ODbL 1.0 (publish it alongside the source code release).\n- Containers, barriers, spawns and the objective are procedural (seed ${cfg.seed}), not OSM data.\n- No map tiles or tile styles are used or bundled.\n`);
console.log(JSON.stringify({ out: `${OUT}.glb`, rotationDeg: +(rot / DEG).toFixed(2), buildings: buildings.length, boxColliderBuildings: nBoxCol, meshColliderBuildings: buildings.length - nBoxCol, roads: roadGeo.length, rails: railGeo.length, coastlineWays: coast.length, seaFraction: +seaFrac.toFixed(3), landSlabs: slabs, containers: nCont, barriers: nBar, cover: nCover, nav: nNav, osmBase }, null, 1));
