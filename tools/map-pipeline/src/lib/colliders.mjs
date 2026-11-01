// SPDX-License-Identifier: GPL-3.0-or-later
// GLB mesh nodes -> simplified static Rapier collider descriptors (+ shared-sim AABBs where exact).
// Rules (per node, first match wins):
//   extras.collider: 'none'|'box'|'cuboid'|'ramp'|'convex'|'sphere'|'capsule'|'mesh'|'trimesh'|'trigger'|'heightfield'
//   (3dmap-creator writes box/ramp/sphere/capsule/mesh/trigger/heightfield/none)
//   name suffix: *_nocol -> none, *_col_box, *_col_convex, *_col_mesh
//   extras.role === 'water' or material named water -> none (water level is gameplay data, not a solid)
//   otherwise 'auto': box if the mesh fills >= 85% of its oriented bounds, else simplified trimesh.
import { fromB64 } from './nav-runtime.mjs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { decompose, isAxisAligned, xform, r3, round } from './math.mjs';

const SURFACES = ['concrete', 'asphalt', 'metal', 'sheetMetal', 'wood', 'glass'];
export function surfaceOf(extras, matName = '') {
  if (extras.material && SURFACES.includes(extras.material)) return extras.material;
  const n = matName.toLowerCase();
  if (/container|sheet|corrug/.test(n)) return 'sheetMetal';
  if (/steel|metal|rail|iron/.test(n)) return 'metal';
  if (/wood|crate|plank|pallet/.test(n)) return 'wood';
  if (/asphalt|road|tarmac/.test(n)) return 'asphalt';
  if (/glass|window/.test(n)) return 'glass';
  return 'concrete';
}

/** Reads all triangle primitives of a node's mesh in LOCAL space. */
export function readMesh(node) {
  const mesh = node.getMesh();
  const pos = [], idx = [];
  let matName = '';
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue; // TRIANGLES only
    const a = prim.getAttribute('POSITION');
    const base = pos.length / 3, el = [];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, el); pos.push(el[0], el[1], el[2]); }
    const ind = prim.getIndices();
    if (ind) for (let i = 0; i < ind.getCount(); i++) idx.push(base + ind.getScalar(i));
    else for (let i = 0; i < a.getCount(); i++) idx.push(base + i);
    matName ||= prim.getMaterial()?.getName() ?? '';
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), matName };
}

function bounds(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  return { mn, mx };
}

function volume(pos, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

/** Weld identical positions (collider meshes don't need split normals/UV seams). */
export function weld(pos, idx, eps = 1e-3) {
  const map = new Map(), out = [], remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] / eps)},${Math.round(pos[i * 3 + 1] / eps)},${Math.round(pos[i * 3 + 2] / eps)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const ni = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]];
    if (a !== b && b !== c && a !== c) ni.push(a, b, c);
  }
  return { pos: new Float32Array(out), idx: new Uint32Array(ni) };
}

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

function modeFor(node, extras) {
  const name = (node.getName() ?? '').toLowerCase();
  if (extras.role === 'water' || /water/.test(name)) return 'none';
  if (name.endsWith('_nocol')) return 'none';
  const sfx = /_col_(box|convex|mesh)$/.exec(name);
  if (sfx) return sfx[1];
  const c = extras.collider;
  if (!c) return 'auto';
  return { cuboid: 'box', trimesh: 'mesh', ramp: 'convex' }[c] ?? c;
}

/**
 * @returns {{ cuboids, convex, trimeshes, heightfields, balls, capsules, sensors, simBoxes, stats }}
 */
export async function buildColliders(entries, { simplifyError = 0.05 } = {}) {
  await MeshoptSimplifier.ready;
  const out = { cuboids: [], convex: [], trimeshes: [], heightfields: [], balls: [], capsules: [], sensors: [], simBoxes: [], stats: { nodes: 0, skipped: 0, trisIn: 0, trisOut: 0 } };
  for (const { node, world } of entries) {
    const extras = node.getExtras() ?? {};
    const mode = modeFor(node, extras);
    const { pos, idx, matName } = readMesh(node);
    if (!idx.length) continue;
    out.stats.nodes++;
    out.stats.trisIn += idx.length / 3;
    if (mode === 'none') { out.stats.skipped++; continue; }
    const material = surfaceOf(extras, matName);
    const { mn, mx } = bounds(pos);
    const { r, s, basis } = decompose(world);
    const lc = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const he = [(mx[0] - mn[0]) / 2 * s[0], (mx[1] - mn[1]) / 2 * s[1], (mx[2] - mn[2]) / 2 * s[2]];
    const c = xform(world, ...lc);
    const fill = Math.abs(volume(pos, idx)) / Math.max(1e-9, (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]));
    let m = mode;
    if (m === 'auto') m = fill >= 0.85 ? 'box' : 'mesh';
    const meta = { node: node.getName(), material, ...(extras.look ? { look: extras.look } : {}), ...(extras.shell !== undefined ? { shell: extras.shell } : {}), ...(extras.fill !== undefined ? { fill: extras.fill } : {}) };
    const worldPts = () => { const w = new Float32Array(pos.length); for (let i = 0; i < pos.length; i += 3) w.set(xform(world, pos[i], pos[i + 1], pos[i + 2]), i); return w; };
    if (m === 'box' || m === 'trigger') {
      const d = { ...meta, c: r3(c), h: r3(he), q: r3(r, 6) };
      if (m === 'trigger') { out.sensors.push(d); continue; }
      out.cuboids.push(d);
      out.stats.trisOut += 12;
      if (isAxisAligned(basis)) {
        // Rotated by k*90° about Y: swap extents into world axes for the shared-sim AABB.
        const ws = [0, 1, 2].map((ax) => basis.reduce((acc, col, k) => acc + Math.abs(col[ax]) * he[k], 0) * 2);
        out.simBoxes.push({ c: { x: round(c[0]), y: round(c[1]), z: round(c[2]) }, s: { x: round(ws[0]), y: round(ws[1]), z: round(ws[2]) }, material, ...(extras.look ? { look: extras.look } : {}), ...(extras.shell !== undefined ? { shell: extras.shell } : {}), ...(extras.fill !== undefined ? { fill: extras.fill } : {}), node: node.getName() });
      }
    } else if (m === 'convex') {
      const w = weld(worldPts(), idx);
      out.convex.push({ ...meta, points: b64(w.pos), n: w.pos.length / 3 });
      out.stats.trisOut += w.idx.length / 3;
    } else if (m === 'sphere') {
      out.balls.push({ ...meta, c: r3(c), radius: round(Math.max(...he)) });
    } else if (m === 'capsule') {
      const radius = Math.max(he[0], he[2]);
      out.capsules.push({ ...meta, c: r3(c), halfHeight: round(Math.max(0, he[1] - radius)), radius: round(radius) });
    } else { // mesh / heightfield both start as a welded, simplified world-space trimesh
      let w = weld(worldPts(), idx);
      const target = Math.max(12, Math.floor(w.idx.length * 0.5 / 3) * 3);
      if (w.idx.length > 36) {
        const [si] = MeshoptSimplifier.simplify(w.idx, w.pos, 3, target, simplifyError, ['ErrorAbsolute', 'LockBorder']);
        if (si.length >= 3) w = { pos: w.pos, idx: si };
      }
      const rec = { ...meta, v: b64(w.pos), i: b64(w.idx), nv: w.pos.length / 3, nt: w.idx.length / 3, ...(extras.simRects ? { simRects: extras.simRects.length } : {}) };
      // Optional authored/baked AABB decomposition for the AABB-only shared sim: [cx, cy, cz, sx, sy, sz] in world space.
      for (const [x, y, z, sx, sy, sz] of extras.simRects ?? []) out.simBoxes.push({ c: { x: round(x), y: round(y), z: round(z) }, s: { x: round(sx), y: round(sy), z: round(sz) }, material, ...(extras.look ? { look: extras.look } : {}), node: node.getName(), approx: true });
      (m === 'heightfield' ? out.heightfields : out.trimeshes).push(rec);
      out.stats.trisOut += rec.nt;
    }
  }
  return out;
}

/** Instantiates every descriptor in a Rapier world (used for validation, nav baking, and by the game loader). */
export function addToWorld(R, world, col) {
  const f32 = (s) => new Float32Array(fromB64(s).buffer);
  const u32 = (s) => new Uint32Array(fromB64(s).buffer);
  let n = 0;
  const rot = (q) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
  for (const b of col.cuboids) { world.createCollider(R.ColliderDesc.cuboid(...b.h).setTranslation(...b.c).setRotation(rot(b.q))); n++; }
  for (const b of col.convex) { const d = R.ColliderDesc.convexHull(f32(b.points)); if (d) { world.createCollider(d); n++; } }
  for (const b of [...col.trimeshes, ...col.heightfields]) { world.createCollider(R.ColliderDesc.trimesh(f32(b.v), u32(b.i))); n++; }
  for (const b of col.balls) { world.createCollider(R.ColliderDesc.ball(b.radius).setTranslation(...b.c)); n++; }
  for (const b of col.capsules) { world.createCollider(R.ColliderDesc.capsule(b.halfHeight, b.radius).setTranslation(...b.c)); n++; }
  for (const b of col.sensors) { world.createCollider(R.ColliderDesc.cuboid(...b.h).setTranslation(...b.c).setRotation(rot(b.q)).setSensor(true)); }
  return n;
}
