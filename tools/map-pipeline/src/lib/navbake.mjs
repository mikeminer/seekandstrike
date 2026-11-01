// SPDX-License-Identifier: GPL-3.0-or-later
// Bakes a 2.5D bot nav grid against the Rapier colliders: walkable ground layer + sparse upper layer,
// stand/crouch clearance (ET crouch ratio), step height, slope limit, 8-direction cover bits and reachability.
import { WALK, CROUCH_ONLY, REACHABLE, WATER, canStep, snap } from './nav-runtime.mjs';

export const AGENT = { radius: 0.35, height: 1.8, crouch: 1.1, step: 0.45, maxSlopeDeg: 45 };
const DIR8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

export function bakeNav(R, world, { bounds, cell = 0.5, waterLevel = -Infinity, seeds = [], agent = AGENT, topY = 40 }) {
  const w = Math.ceil((bounds.maxX - bounds.minX) / cell), h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const origin = [bounds.minX, bounds.minZ];
  const flags = new Uint8Array(w * h), height = new Int16Array(w * h), coverLow = new Uint8Array(w * h), coverHigh = new Uint8Array(w * h);
  const upper = [];
  const cosSlope = Math.cos(agent.maxSlopeDeg * Math.PI / 180);
  const lift = 0.3;
  const capFor = (H) => new R.Capsule(Math.max(0.01, (H - lift) / 2 - agent.radius), agent.radius);
  const capStand = capFor(agent.height), capCrouch = capFor(agent.crouch);
  const I = { x: 0, y: 0, z: 0, w: 1 };
  const clear = (x, y, z, H, cap) => world.intersectionWithShape({ x, y: y + lift + (H - lift) / 2, z }, I, cap) === null;
  const down = { x: 0, y: -1, z: 0 };
  let rays = 0;
  for (let iz = 0; iz < h; iz++) for (let ix = 0; ix < w; ix++) {
    const x = origin[0] + (ix + 0.5) * cell, z = origin[1] + (iz + 0.5) * cell;
    let y0 = topY;
    const layers = [];
    for (let guard = 0; guard < 12; guard++) {
      // Solid cast finds the next surface from outside; if we start inside a solid, a non-solid cast finds its exit.
      const hit = world.castRayAndGetNormal(new R.Ray({ x, y: y0, z }, down), y0 + 20, true);
      rays++;
      if (!hit) break;
      if (hit.timeOfImpact <= 1e-6) {
        const ex = world.castRayAndGetNormal(new R.Ray({ x, y: y0, z }, down), y0 + 20, false);
        rays++;
        if (!ex) break;
        y0 = y0 - ex.timeOfImpact - 0.02;
        continue;
      }
      const y = y0 - hit.timeOfImpact;
      if (hit.normal.y >= cosSlope) layers.push(y);
      y0 = y - 0.02;
    }
    const k = iz * w + ix;
    // Ground = lowest surface an agent fits on (standing, else crouching). Surfaces buried under other solids
    // (seabed under a quay slab, ground under a wall) fail the clearance test and are skipped.
    let gi = -1, gf = 0;
    for (let l = layers.length - 1; l >= 0 && gi < 0; l--) {
      const y = layers[l];
      if (clear(x, y, z, agent.height, capStand)) { gi = l; gf = WALK; }
      else if (clear(x, y, z, agent.crouch, capCrouch)) { gi = l; gf = WALK | CROUCH_ONLY; }
      if (gi >= 0 && y < waterLevel + 0.05) gf = WATER; // open water above this floor
    }
    if (!layers.length) { flags[k] = 0; height[k] = -32768; continue; }
    if (gi < 0) gi = layers.length - 1; // fully enclosed: record height, not walkable
    const gy = layers[gi];
    height[k] = Math.round(gy * 100);
    flags[k] = gf;
    if (gf === WATER) continue;
    for (let l = gi - 1; l >= 0; l--) {
      const uy = layers[l];
      if (uy - gy > 1.0 && clear(x, uy, z, agent.crouch, capCrouch)) upper.push([ix, iz, Math.round(uy * 100)]);
    }
    if (flags[k] & WALK) {
      for (let d = 0; d < 8; d++) {
        const dir = { x: DIR8[d][0], y: 0, z: DIR8[d][1] };
        if (world.castRay(new R.Ray({ x, y: gy + 0.8, z }, dir), 1.2, true)) coverLow[k] |= 1 << d;
        if (world.castRay(new R.Ray({ x, y: gy + 1.55, z }, dir), 1.2, true)) coverHigh[k] |= 1 << d;
        rays += 2;
      }
    }
  }
  const g = { w, h, cell, origin, agent, flags, height, coverLow, coverHigh };
  // Reachability flood from seeds (attack spawns) using the same step rules as A*.
  const q = [];
  for (const s of seeds) { const c = snap(g, s[0], s[2], 8, s[1]); if (c) { const k = c[1] * w + c[0]; if (!(flags[k] & REACHABLE)) { flags[k] |= REACHABLE; q.push(k); } } }
  while (q.length) {
    const k = q.pop(), ix = k % w, iz = (k / w) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const jx = ix + dx, jz = iz + dz;
      if (!canStep(g, ix, iz, jx, jz)) continue;
      const j = jz * w + jx;
      if (!(flags[j] & REACHABLE)) { flags[j] |= REACHABLE; q.push(j); }
    }
  }
  let walk = 0, reach = 0, crouch = 0, covered = 0;
  for (let k = 0; k < w * h; k++) { if (flags[k] & WALK) walk++; if (flags[k] & REACHABLE) reach++; if (flags[k] & CROUCH_ONLY) crouch++; if (coverLow[k]) covered++; }
  return { g, upper, stats: { w, h, cells: w * h, walkable: walk, reachable: reach, crouchOnly: crouch, withCover: covered, upperCells: upper.length, rays } };
}

export function encodeGrid(g, upper) {
  const b = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');
  return { format: 'seek-strike-navgrid', version: 1, w: g.w, h: g.h, cell: g.cell, origin: g.origin, agent: g.agent,
    bits: { WALK: 1, CROUCH_ONLY: 2, REACHABLE: 4, WATER: 8 }, coverDirs: 'bit d = direction (cos(d*45deg), sin(d*45deg)) in XZ',
    flags: b(g.flags), height: b(g.height), coverLow: b(g.coverLow), coverHigh: b(g.coverHigh), upper };
}
