/**
 * Static-world queries over the map's AABBs (pure, used by the shared sim, bots and tests).
 * The client additionally mirrors the same boxes into Rapier for character collision.
 */
import type { MapBox, MapDef } from './types';
import type { RayHit } from '../sim/ballistics';
import { type Vec3, v3, distXZ } from '../sim/vec';

const EPS = 1e-9;

/** Slab test. Returns entry distance and the hit face normal, or null. */
export function rayBox(o: Vec3, d: Vec3, maxDist: number, b: MapBox): { t: number; n: Vec3; tExit: number } | null {
  let tmin = 0;
  let tmax = maxDist;
  let nAxis = -1;
  let nSign = 0;
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    const a = axes[i]!;
    const lo = b.c[a] - b.s[a] / 2;
    const hi = b.c[a] + b.s[a] / 2;
    const da = d[a];
    if (Math.abs(da) < EPS) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }
    let t1 = (lo - o[a]) / da;
    let t2 = (hi - o[a]) / da;
    let sign = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = i; nSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null; // ray starts inside the box: ignore (lets rounds exit after penetration)
  const n = v3();
  n[axes[nAxis]!] = nSign;
  return { t: tmin, n, tExit: tmax };
}

/** Closest static hit along a ray, including the ground plane (y = 0). */
export function raycastStatic(map: MapDef, o: Vec3, d: Vec3, maxDist: number): RayHit | null {
  let best: RayHit | null = null;
  let bestT = maxDist;
  if (d.y < -EPS) {
    const t = -o.y / d.y;
    if (t >= 0 && t <= bestT && o.y >= 0) {
      const inWater = (o.x + d.x * t) > map.bounds.maxX + 0.5;
      if (!inWater) {
        bestT = t;
        best = { distance: t, point: v3(o.x + d.x * t, 0, o.z + d.z * t), normal: v3(0, 1, 0), material: 'asphalt', thickness: Infinity };
      }
    }
  }
  for (const b of map.boxes) {
    const r = rayBox(o, d, bestT, b);
    if (r && r.t <= bestT) {
      bestT = r.t;
      const through = r.tExit - r.t;
      best = {
        distance: r.t,
        point: v3(o.x + d.x * r.t, o.y + d.y * r.t, o.z + d.z * r.t),
        normal: r.n,
        material: b.material,
        // Hollow shell: two walls of steel/wood; loaded or solid: the full span.
        thickness: b.shell !== undefined && !(b.fill && b.fill > 0) ? b.shell * 2 : through,
        span: through,
      };
    }
  }
  return best;
}

export function lineOfSight(map: MapDef, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) return true;
  const d = v3(dx / l, dy / l, dz / l);
  // Sheet-metal and wood still block sight even if bullets pass.
  for (const box of map.boxes) if (rayBox(a, d, l, box)) return false;
  return true;
}

/** True if a vertical capsule of `radius` at feet position `p` overlaps any box (XZ test, below `height`). */
export function blockedAt(map: MapDef, p: Vec3, radius: number, height = 1.8): boolean {
  for (const b of map.boxes) {
    if (b.c.y - b.s.y / 2 > p.y + height || b.c.y + b.s.y / 2 < p.y + 0.3) continue;
    const dx = Math.max(Math.abs(p.x - b.c.x) - b.s.x / 2, 0);
    const dz = Math.max(Math.abs(p.z - b.c.z) - b.s.z / 2, 0);
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

/** Walkable straight segment at knee and chest height with a body-width clearance. */
export function walkable(map: MapDef, a: Vec3, b: Vec3, radius = 0.35): boolean {
  const steps = Math.ceil(distXZ(a, b) / 0.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = v3(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
    if (blockedAt(map, p, radius)) return false;
  }
  return true;
}

export interface NavGraph {
  nodes: Vec3[];
  links: number[][];
}

export function buildNavGraph(map: MapDef, maxLink = 16): NavGraph {
  const nodes = map.waypoints;
  const links: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      if (distXZ(a, b) <= maxLink && walkable(map, a, b)) {
        links[i]!.push(j);
        links[j]!.push(i);
      }
    }
  }
  return { nodes, links };
}

export function nearestNode(g: NavGraph, map: MapDef, p: Vec3, requireWalkable = true): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = distXZ(p, g.nodes[i]!);
    if (d < bestD && (!requireWalkable || walkable(map, p, g.nodes[i]!, 0.3))) { bestD = d; best = i; }
  }
  if (best < 0 && requireWalkable) return nearestNode(g, map, p, false);
  return best;
}

/** A* over the waypoint graph. Returns node indices from start to goal (inclusive) or []. */
export function findPath(g: NavGraph, start: number, goal: number): number[] {
  if (start < 0 || goal < 0) return [];
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const open = new Set<number>([start]);
  const closed = new Uint8Array(n);
  gScore[start] = 0;
  const h = (i: number): number => distXZ(g.nodes[i]!, g.nodes[goal]!);
  while (open.size) {
    let cur = -1, bestF = Infinity;
    for (const i of open) { const f = gScore[i]! + h(i); if (f < bestF) { bestF = f; cur = i; } }
    if (cur === goal) {
      const path = [cur];
      while (came[cur]! >= 0) { cur = came[cur]!; path.push(cur); }
      return path.reverse();
    }
    open.delete(cur);
    closed[cur] = 1;
    for (const nb of g.links[cur]!) {
      if (closed[nb]) continue;
      const t = gScore[cur]! + distXZ(g.nodes[cur]!, g.nodes[nb]!);
      if (t < gScore[nb]!) { gScore[nb] = t; came[nb] = cur; open.add(nb); }
    }
  }
  return [];
}

/** Candidate cover spots: just outside each solid face, at least 0.85 m tall. */
export function coverPoints(map: MapDef): Vec3[] {
  const pts: Vec3[] = [];
  for (const b of map.boxes) {
    if (b.c.y - b.s.y / 2 > 0.1 || b.s.y < 0.85) continue;
    const off = 0.75;
    const cands = [
      v3(b.c.x + b.s.x / 2 + off, 0, b.c.z), v3(b.c.x - b.s.x / 2 - off, 0, b.c.z),
      v3(b.c.x, 0, b.c.z + b.s.z / 2 + off), v3(b.c.x, 0, b.c.z - b.s.z / 2 - off),
    ];
    for (const p of cands) {
      if (p.x < map.bounds.minX + 1 || p.x > map.bounds.maxX - 1 || p.z < map.bounds.minZ + 1 || p.z > map.bounds.maxZ - 1) continue;
      if (!blockedAt(map, p, 0.4)) pts.push(p);
    }
  }
  return pts;
}
