/**
 * Baked bot navigation grid (pure, deterministic, no dependencies). TypeScript port of
 * tools/map-pipeline/src/lib/nav-runtime.mjs: a 2.5D grid (0.5 m cells) with height, walk flags
 * and cover bits, searched with A* (octile heuristic) and string-pulled into corner points.
 */
import { type Vec3, v3 } from '../sim/vec';

export const NAV_WALK = 1;
export const NAV_CROUCH_ONLY = 2;
export const NAV_REACHABLE = 4;
export const NAV_WATER = 8;

/** `navgrid.json` as written by tools/map-pipeline (`seek-strike-navgrid` v1). */
export interface NavGridJson {
  format: string;
  version: number;
  w: number;
  h: number;
  cell: number;
  origin: [number, number];
  agent: { radius: number; height: number; crouch: number; step: number; maxSlopeDeg: number };
  /** base64 Uint8, one byte per cell. */
  flags: string;
  /** base64 Int16 (little endian), floor height in centimetres per cell. */
  height: string;
  coverLow: string;
  coverHigh: string;
}

export interface NavGrid {
  w: number;
  h: number;
  cell: number;
  origin: [number, number];
  agent: NavGridJson['agent'];
  flags: Uint8Array;
  /** Floor height in centimetres. */
  height: Int16Array;
  coverLow: Uint8Array;
  coverHigh: Uint8Array;
}

/** base64 to a fresh, aligned Uint8Array. */
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function decodeNavGrid(j: NavGridJson): NavGrid {
  if (j.format !== 'seek-strike-navgrid' || j.version !== 1) throw new Error('unsupported navgrid format');
  const h8 = fromB64(j.height);
  const grid: NavGrid = {
    w: j.w, h: j.h, cell: j.cell, origin: j.origin, agent: j.agent,
    flags: fromB64(j.flags),
    height: new Int16Array(h8.buffer, h8.byteOffset, h8.byteLength >> 1),
    coverLow: fromB64(j.coverLow),
    coverHigh: fromB64(j.coverHigh),
  };
  const n = j.w * j.h;
  if (grid.flags.length !== n || grid.height.length !== n || grid.coverLow.length !== n) throw new Error('navgrid size mismatch');
  return grid;
}

const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const cellOf = (g: NavGrid, x: number, z: number): [number, number] =>
  [Math.floor((x - g.origin[0]) / g.cell), Math.floor((z - g.origin[1]) / g.cell)];

export const cellCenter = (g: NavGrid, ix: number, iz: number): Vec3 =>
  v3(g.origin[0] + (ix + 0.5) * g.cell, g.height[iz * g.w + ix]! / 100, g.origin[1] + (iz + 0.5) * g.cell);

export const cellWalkable = (g: NavGrid, ix: number, iz: number): boolean =>
  ix >= 0 && iz >= 0 && ix < g.w && iz < g.h && (g.flags[iz * g.w + ix]! & NAV_WALK) !== 0;

/** Can an agent step from cell a to its neighbour b? (step height, no diagonal corner cutting) */
export function canStep(g: NavGrid, ax: number, az: number, bx: number, bz: number): boolean {
  if (!cellWalkable(g, bx, bz)) return false;
  if (Math.abs(g.height[bz * g.w + bx]! - g.height[az * g.w + ax]!) > g.agent.step * 100) return false;
  if (ax !== bx && az !== bz && (!cellWalkable(g, bx, az) || !cellWalkable(g, ax, bz))) return false;
  return true;
}

/**
 * Nearest walkable cell within `r` cells. Prefers reachable cells whose floor is within
 * [y - 1.2, y + 0.5] so a point on a console snaps to the floor beside it.
 */
export function snapToGrid(g: NavGrid, x: number, z: number, y: number | null = null, r = 8): [number, number] | null {
  const [cx, cz] = cellOf(g, x, z);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const ix = cx + dx, iz = cz + dz;
      if (!cellWalkable(g, ix, iz)) continue;
      const k = iz * g.w + ix;
      let d = dx * dx + dz * dz;
      if (!(g.flags[k]! & NAV_REACHABLE)) d += 1e3;
      if (y !== null && (g.height[k]! / 100 > y + 0.5 || g.height[k]! / 100 < y - 1.2)) d += 1e6;
      if (d < bd) { bd = d; best = [ix, iz]; }
    }
  }
  return best;
}

/** Grid line-of-walk (supercover) used for string pulling. */
export function walkLine(g: NavGrid, ax: number, az: number, bx: number, bz: number): boolean {
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

function smooth(g: NavGrid, cells: number[]): Vec3[] {
  const at = (i: number): Vec3 => cellCenter(g, i % g.w, (i / g.w) | 0);
  if (cells.length < 3) return cells.map(at);
  const out = [cells[0]!];
  let anchor = cells[0]!;
  for (let k = 2; k < cells.length; k++) {
    const c = cells[k]!;
    if (!walkLine(g, anchor % g.w, (anchor / g.w) | 0, c % g.w, (c / g.w) | 0)) {
      anchor = cells[k - 1]!;
      out.push(anchor);
    }
  }
  out.push(cells[cells.length - 1]!);
  return out.map(at);
}

export interface GridPath {
  cells: number[];
  /** Metres along the cell centres. */
  length: number;
  /** String-pulled corner points (first = start cell centre, last = goal cell centre). */
  points: Vec3[];
}

export interface PathOptions {
  /** Extra cost per cell without low cover (makes bots prefer covered routes). */
  exposure?: number;
}

/** A* with octile heuristic; crouch-only cells cost 1.6x. Returns null when no route exists. */
export function findGridPath(g: NavGrid, from: Vec3, to: Vec3, opts: PathOptions = {}): GridPath | null {
  const a = snapToGrid(g, from.x, from.z, from.y);
  const b = snapToGrid(g, to.x, to.z, to.y);
  if (!a || !b) return null;
  const exposure = opts.exposure ?? 0;
  const N = g.w * g.h;
  const start = a[1] * g.w + a[0];
  const goal = b[1] * g.w + b[0];
  const gs = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);

  // Binary min-heap on (f, cell); ties broken by insertion order for determinism.
  const hf: number[] = [];
  const hi: number[] = [];
  const less = (p: number, q: number): boolean => hf[p]! < hf[q]!;
  const swap = (p: number, q: number): void => {
    const f = hf[p]!; hf[p] = hf[q]!; hf[q] = f;
    const i = hi[p]!; hi[p] = hi[q]!; hi[q] = i;
  };
  const push = (f: number, i: number): void => {
    hf.push(f); hi.push(i);
    let k = hf.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (!less(k, p)) break; swap(k, p); k = p; }
  };
  const pop = (): number => {
    const top = hi[0]!;
    const lf = hf.pop()!; const li = hi.pop()!;
    if (hf.length) {
      hf[0] = lf; hi[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hf.length && less(l, m)) m = l;
        if (r < hf.length && less(r, m)) m = r;
        if (m === k) break;
        swap(m, k); k = m;
      }
    }
    return top;
  };
  const hx = (i: number): number => {
    const dx = Math.abs((i % g.w) - b[0]), dz = Math.abs(((i / g.w) | 0) - b[1]);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };

  gs[start] = 0;
  push(hx(start), start);
  while (hf.length) {
    const i = pop();
    if (i === goal) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const ix = i % g.w, iz = (i / g.w) | 0;
    for (const [dx, dz] of DIRS) {
      const jx = ix + dx, jz = iz + dz;
      if (!canStep(g, ix, iz, jx, jz)) continue;
      const j = jz * g.w + jx;
      let c = dx && dz ? Math.SQRT2 : 1;
      if (g.flags[j]! & NAV_CROUCH_ONLY) c *= 1.6;
      if (exposure && !g.coverLow[j]) c += exposure;
      const ng = gs[i]! + c;
      if (ng < gs[j]!) { gs[j] = ng; came[j] = i; push(ng + hx(j), j); }
    }
  }
  if (came[goal]! < 0 && goal !== start) return null;
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = came[i]!) cells.push(i);
  cells.reverse();
  let length = 0;
  for (let k = 1; k < cells.length; k++) {
    const p = cells[k - 1]!, c = cells[k]!;
    length += Math.hypot((p % g.w) - (c % g.w), ((p / g.w) | 0) - ((c / g.w) | 0)) * g.cell;
  }
  return { cells, length, points: smooth(g, cells) };
}
