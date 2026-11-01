/**
 * Where vegetation grows on a pipeline map. Pure and deterministic (tested), no Three.js.
 *
 * Fairness rule (SEEK & STRIKE): vegetation is render-only and bots see through it, so nothing
 * inside the playable area may hide a crouching player. Weeds stay ankle-high, ivy lies flat on
 * walls, and trees (high crowns) only grow in a band along the map perimeter, away from spawns
 * and the objective.
 */
import type { FacadeEdge, MassRect } from '../architecture/plan';

export interface Rect2 { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Point2 { x: number; z: number }

export const TREE_RULES = { perimeterBand: 12, clearOfSolids: 4.5, clearOfMarkers: 12, spacing: 9, max: 18, onLandMargin: 2 } as const;
export const WEED_MAX_HEIGHT = 0.35;

/** Mulberry32. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inside = (p: Point2, r: Rect2, margin = 0): boolean =>
  p.x >= r.minX + margin && p.x <= r.maxX - margin && p.z >= r.minZ + margin && p.z <= r.maxZ - margin;
const distToRect = (p: Point2, r: Rect2): number =>
  Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));

export interface TreeSpot { x: number; z: number; rotation: number; scale: number; variant: number }

export function treeSpots(opts: { bounds: Rect2; land: readonly Rect2[]; solids: readonly Rect2[]; markers: readonly Point2[]; seed: number; variants: number }): TreeSpot[] {
  const R = TREE_RULES, r = rand(opts.seed), b = opts.bounds;
  // Collect every valid candidate first, then accept in a seeded shuffled order, so the trees
  // spread over the whole perimeter instead of filling the first side the scan reaches.
  const candidates: Point2[] = [];
  for (let z = b.minZ + 2; z <= b.maxZ - 2; z += 4) for (let x = b.minX + 2; x <= b.maxX - 2; x += 4) {
    const p = { x: x + (r() - 0.5) * 3, z: z + (r() - 0.5) * 3 };
    const edge = Math.min(p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z);
    if (edge > R.perimeterBand || edge < 1.5) continue;
    if (!opts.land.some((l) => inside(p, l, R.onLandMargin))) continue;
    if (opts.solids.some((s) => distToRect(p, s) < R.clearOfSolids)) continue;
    if (opts.markers.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < R.clearOfMarkers)) continue;
    candidates.push(p);
  }
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]; }
  const out: TreeSpot[] = [];
  for (const p of candidates) {
    if (out.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < R.spacing)) continue;
    out.push({ ...p, rotation: r() * Math.PI * 2, scale: 0.85 + r() * 0.3, variant: Math.floor(r() * opts.variants) });
    if (out.length >= R.max) break;
  }
  return out;
}

export interface WeedSpot { x: number; z: number; rotation: number; scale: number; tint: number }

/** Weeds where feet and wheels do not reach: wall bases and quay edges. */
export function weedSpots(opts: { edges: readonly FacadeEdge[]; land: readonly Rect2[]; solids: readonly Rect2[]; seed: number }): WeedSpot[] {
  const r = rand(opts.seed), out: WeedSpot[] = [];
  const push = (x: number, z: number): void => {
    const p = { x, z };
    if (!opts.land.some((l) => inside(p, l, 0.15))) return;
    if (opts.solids.some((s) => inside(p, s, -0.02))) return; // never inside a box
    out.push({ x, z, rotation: r() * Math.PI * 2, scale: 0.6 + r() * 0.4, tint: r() });
  };
  for (const e of opts.edges) {
    if (e.y0 > 0.01) continue; // only walls that reach the ground
    for (let u = e.a + 0.3; u < e.b - 0.3; u += 0.6) {
      if (r() > 0.55) continue;
      const off = 0.08 + r() * 0.3, along = u + (r() - 0.5) * 0.4;
      const sgn = e.side === '+x' || e.side === '+z' ? 1 : -1;
      if (e.side === '+x' || e.side === '-x') push(e.plane + sgn * off, along); else push(along, e.plane + sgn * off);
    }
  }
  for (const l of opts.land) {
    const sides: [number, number, number, number, boolean][] = [
      [l.minX, l.maxX, l.minZ, 1, true], [l.minX, l.maxX, l.maxZ, -1, true], [l.minZ, l.maxZ, l.minX, 1, false], [l.minZ, l.maxZ, l.maxX, -1, false],
    ];
    for (const [a, bb, fixed, inward, alongX] of sides) {
      for (let u = a + 0.5; u < bb - 0.5; u += 0.8) {
        if (r() > 0.5) continue;
        const off = 0.25 + r() * 0.4;
        if (alongX) push(u, fixed + inward * off); else push(fixed + inward * off, u);
      }
    }
  }
  return out;
}

export interface IvyPatch { edge: FacadeEdge; center: number; width: number; height: number; seed: number }

/** Ivy on walls facing away from the late sun (east / north), on long ground-level façades. */
export function ivyPatches(opts: { edges: readonly FacadeEdge[]; seed: number; shadySides: readonly FacadeEdge['side'][] }): IvyPatch[] {
  const r = rand(opts.seed), out: IvyPatch[] = [];
  for (const e of opts.edges) {
    if (e.y0 > 0.01 || e.b - e.a < 5 || !opts.shadySides.includes(e.side)) continue;
    if (r() > 0.45) continue;
    const width = Math.min(e.b - e.a - 1, 3 + r() * 5);
    const center = e.a + width / 2 + 0.5 + r() * Math.max(0, e.b - e.a - width - 1);
    const height = Math.min(e.y1 - 0.8, 2.5 + r() * 7);
    if (height < 1.5) continue;
    out.push({ edge: e, center, width, height, seed: Math.floor(r() * 2 ** 31) });
  }
  return out;
}

/** Mass rects → 2D footprints (buildings and box props both block trees and weeds). */
export const footprints = (rects: readonly (MassRect | Rect2)[]): Rect2[] => rects.map((m) => ({ minX: m.minX, maxX: m.maxX, minZ: m.minZ, maxZ: m.maxZ }));
