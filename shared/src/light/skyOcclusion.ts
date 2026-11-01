/**
 * Sky occlusion ("baked ambient light") against the map's axis-aligned solids.
 *
 * Used twice with the same code, so ground and walls agree:
 *  - offline by tools/light-bake (ground lightmap PNG shipped with the map);
 *  - once at map load for the procedural façades (per-vertex, in the vertex colour).
 * Pure and dependency-free (also runs under `node` with type stripping). Deterministic.
 */

export interface Aabb { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

/** Pipeline collider boxes → AABBs above the ground plane (slabs at or below y = 0 never occlude the sky). */
export function aabbsFromSimBoxes(boxes: readonly { c: { x: number; y: number; z: number }; s: { x: number; y: number; z: number } }[]): Aabb[] {
  const out: Aabb[] = [];
  for (const b of boxes) {
    const maxY = b.c.y + b.s.y / 2;
    if (maxY <= 0.05) continue;
    out.push({ minX: b.c.x - b.s.x / 2, maxX: b.c.x + b.s.x / 2, minY: b.c.y - b.s.y / 2, maxY, minZ: b.c.z - b.s.z / 2, maxZ: b.c.z + b.s.z / 2 });
  }
  return out;
}

/** Cosine-weighted hemisphere directions around +Y (Fibonacci spiral, fixed for determinism). */
function hemisphere(n: number): Float64Array {
  const d = new Float64Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u), y = Math.sqrt(1 - u), phi = i * golden;
    d[i * 3] = r * Math.cos(phi); d[i * 3 + 1] = y; d[i * 3 + 2] = r * Math.sin(phi);
  }
  return d;
}

/** Distance along the ray to the box, or Infinity (slab test; origin inside counts as 0). */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Aabb, tMax: number): number {
  let t0 = 0, t1 = tMax;
  const axes: [number, number, number, number][] = [[ox, dx, b.minX, b.maxX], [oy, dy, b.minY, b.maxY], [oz, dz, b.minZ, b.maxZ]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export interface OcclusionOptions { samples?: number; maxDistance?: number; cell?: number }

/**
 * Sky visibility in [0, 1] (1 = open sky) for a surface point and its normal.
 * A hit at distance t occludes with weight (1 - t / maxDistance): near walls darken more than far ones.
 */
export class OcclusionField {
  readonly maxDistance: number;
  private readonly dirs: Float64Array;
  private readonly samples: number;
  private readonly cell: number;
  private readonly grid = new Map<string, Aabb[]>();

  // No TypeScript parameter properties: this file also runs under Node's strip-only type support.
  constructor(boxes: readonly Aabb[], opts: OcclusionOptions = {}) {
    this.samples = opts.samples ?? 16;
    this.maxDistance = opts.maxDistance ?? 24;
    this.cell = opts.cell ?? 8;
    this.dirs = hemisphere(this.samples);
    const reach = this.maxDistance;
    for (const b of boxes) {
      const x0 = Math.floor((b.minX - reach) / this.cell), x1 = Math.floor((b.maxX + reach) / this.cell);
      const z0 = Math.floor((b.minZ - reach) / this.cell), z1 = Math.floor((b.maxZ + reach) / this.cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = `${x},${z}`;
        const list = this.grid.get(k);
        if (list) list.push(b); else this.grid.set(k, [b]);
      }
    }
  }

  /** Boxes that a ray of length maxDistance from (x, z) can reach. */
  candidates(x: number, z: number): readonly Aabb[] {
    return this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`) ?? [];
  }

  visibility(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
    const near = this.candidates(px, pz);
    if (!near.length) return 1;
    // Orthonormal basis (t, n, b) around the normal.
    let tx = 1, ty = 0, tz = 0;
    if (Math.abs(nx) > 0.9) { tx = 0; ty = 0; tz = 1; }
    let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
    // Start slightly off the surface so the owning box does not occlude itself.
    const ox = px + nx * 0.03, oy = py + ny * 0.03, oz = pz + nz * 0.03;
    let occluded = 0;
    for (let i = 0; i < this.samples; i++) {
      const u = this.dirs[i * 3]!, v = this.dirs[i * 3 + 1]!, w = this.dirs[i * 3 + 2]!;
      const dx = tx * u + nx * v + bx * w, dy = ty * u + ny * v + by * w, dz = tz * u + nz * v + bz * w;
      let best = Infinity;
      for (const b of near) {
        const t = rayBox(ox, oy, oz, dx, dy, dz, b, this.maxDistance);
        if (t < best) best = t;
      }
      if (best < this.maxDistance) occluded += 1 - best / this.maxDistance;
    }
    return 1 - occluded / this.samples;
  }
}
