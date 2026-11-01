// SPDX-License-Identifier: GPL-3.0-or-later
// Dependency-free runtime for the baked bot nav grid (port 1:1 to shared/src/nav/*.ts for the game + server).
/** base64 -> fresh, aligned Uint8Array (Node or browser; never a view into a pooled Buffer). */
export function fromB64(s) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); const u = new Uint8Array(b.byteLength); u.set(b); return u; }
  const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}

export const WALK = 1, CROUCH_ONLY = 2, REACHABLE = 4, WATER = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function decodeGrid(j) {
  const u8 = (s) => fromB64(s);
  const i16 = (s) => new Int16Array(fromB64(s).buffer);
  return { ...j, flags: u8(j.flags), height: i16(j.height), coverLow: u8(j.coverLow), coverHigh: u8(j.coverHigh) };
}
export const cellOf = (g, x, z) => [Math.floor((x - g.origin[0]) / g.cell), Math.floor((z - g.origin[1]) / g.cell)];
export const centerOf = (g, ix, iz) => [g.origin[0] + (ix + 0.5) * g.cell, g.height[iz * g.w + ix] / 100, g.origin[1] + (iz + 0.5) * g.cell];
export const walkable = (g, ix, iz) => ix >= 0 && iz >= 0 && ix < g.w && iz < g.h && (g.flags[iz * g.w + ix] & WALK) !== 0;

/** Can an agent step from cell a to neighbour b? (step height, no diagonal corner cutting) */
export function canStep(g, ax, az, bx, bz) {
  if (!walkable(g, bx, bz)) return false;
  if (Math.abs(g.height[bz * g.w + bx] - g.height[az * g.w + ax]) > g.agent.step * 100) return false;
  if (ax !== bx && az !== bz && (!walkable(g, bx, az) || !walkable(g, ax, bz))) return false;
  return true;
}

/**
 * Nearest walkable cell to (x, y, z) within r cells (spawns/objectives often sit against walls or on consoles).
 * Prefers reachable cells whose floor is at most 1.2 m below/above y (so a charge point on a console snaps
 * to the floor in front of it, not to the console top).
 */
export function snap(g, x, z, r = 8, y = null) {
  const [cx, cz] = cellOf(g, x, z);
  let best = null, bd = Infinity;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (!walkable(g, ix, iz)) continue;
    const k = iz * g.w + ix;
    let d = dx * dx + dz * dz;
    if (!(g.flags[k] & REACHABLE)) d += 1e3;
    if (y !== null && (g.height[k] / 100 > y + 0.5 || g.height[k] / 100 < y - 1.2)) d += 1e6;
    if (d < bd) { bd = d; best = [ix, iz]; }
  }
  return best;
}

/** A* with octile heuristic; crouch-only cells cost 1.6x, exposed cells (no cover) cost `exposure` extra. */
export function findPath(g, from, to, { exposure = 0 } = {}) {
  const a = snap(g, from[0], from[2], 8, from[1]), b = snap(g, to[0], to[2], 8, to[1]);
  if (!a || !b) return null;
  const N = g.w * g.h, start = a[1] * g.w + a[0], goal = b[1] * g.w + b[0];
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [], push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const hx = (i) => { const dx = Math.abs((i % g.w) - b[0]), dz = Math.abs(((i / g.w) | 0) - b[1]); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
  gs[start] = 0; push(hx(start), start);
  while (heap.length) {
    const [, i] = pop();
    if (i === goal) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const ix = i % g.w, iz = (i / g.w) | 0;
    for (const [dx, dz] of DIRS) {
      const jx = ix + dx, jz = iz + dz;
      if (!canStep(g, ix, iz, jx, jz)) continue;
      const j = jz * g.w + jx;
      let c = dx && dz ? Math.SQRT2 : 1;
      if (g.flags[j] & CROUCH_ONLY) c *= 1.6;
      if (exposure && !g.coverLow[j]) c += exposure;
      const ng = gs[i] + c;
      if (ng < gs[j]) { gs[j] = ng; came[j] = i; push(ng + hx(j), j); }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  let length = 0;
  for (let k = 1; k < cells.length; k++) { const a = cells[k - 1], c = cells[k]; length += Math.hypot((a % g.w) - (c % g.w), ((a / g.w) | 0) - ((c / g.w) | 0)) * g.cell; }
  return { cells, length, cost: gs[goal] * g.cell, points: smooth(g, cells) };
}

/** Grid line-of-walk (supercover) used for string pulling and waypoint linking. */
export function walkLine(g, ax, az, bx, bz) {
  let x = ax, z = az;
  const dx = Math.abs(bx - ax), dz = Math.abs(bz - az), sx = Math.sign(bx - ax), sz = Math.sign(bz - az);
  let e = dx - dz;
  while (x !== bx || z !== bz) {
    const e2 = 2 * e;
    const px = x, pz = z;
    if (e2 > -dz) { e -= dz; x += sx; }
    if (e2 < dx) { e += dx; z += sz; }
    if (!canStep(g, px, pz, x, z)) return false;
  }
  return true;
}

function smooth(g, cells) {
  if (cells.length < 3) return cells.map((i) => centerOf(g, i % g.w, (i / g.w) | 0));
  const out = [cells[0]];
  let anchor = cells[0];
  for (let k = 2; k < cells.length; k++) {
    const a = anchor, c = cells[k];
    if (!walkLine(g, a % g.w, (a / g.w) | 0, c % g.w, (c / g.w) | 0)) { anchor = cells[k - 1]; out.push(anchor); }
  }
  out.push(cells[cells.length - 1]);
  return out.map((i) => centerOf(g, i % g.w, (i / g.w) | 0));
}
