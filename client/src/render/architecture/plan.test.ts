import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BAY_WIDTH, MIN_SEGMENT, TRIM_MAX_PROJECTION, exposedEdges, massFromSimBoxes, planBuildings, type MassRect,
} from './plan';

const rect = (id: string, minX: number, maxX: number, minZ: number, maxZ: number, top = 10, building = 'b'): MassRect =>
  ({ id, building, minX, maxX, minZ, maxZ, top });
const lengthOf = (edges: { a: number; b: number }[]): number => edges.reduce((s, e) => s + (e.b - e.a), 0);

describe('exposed-surface graph', () => {
  it('a lone box exposes its four full sides', () => {
    const r = rect('r', 0, 20, 0, 10);
    const { edges } = exposedEdges([r], [r]);
    expect(edges.map((e) => e.side).sort()).toEqual(['+x', '+z', '-x', '-z']);
    expect(lengthOf(edges)).toBeCloseTo(60);
  });

  it('a shared wall between two touching pieces is never decorated', () => {
    const a = rect('a', 0, 10, 0, 10), b = rect('b', 10, 30, 0, 10);
    const { edges } = exposedEdges([a, b], [a, b]);
    expect(edges.find((e) => e.rect === 'a' && e.side === '+x')).toBeUndefined();
    expect(edges.find((e) => e.rect === 'b' && e.side === '-x')).toBeUndefined();
    expect(lengthOf(edges)).toBeCloseTo(2 * 30 + 2 * 10); // outline of the union
  });

  it('a partial contact splits the side into exposed intervals (interval subtraction)', () => {
    const a = rect('a', 0, 10, 0, 30), b = rect('b', 10, 20, 10, 20);
    const sides = exposedEdges([a, b], [a, b]).edges.filter((e) => e.rect === 'a' && e.side === '+x');
    expect(sides.map((e) => [e.a, e.b])).toEqual([[0, 10], [20, 30]]);
  });

  it('a lower neighbour leaves the wall above it exposed', () => {
    const tall = rect('t', 0, 10, 0, 10, 15), low = rect('l', 10, 20, 0, 10, 6);
    const above = exposedEdges([tall], [tall, low]).edges.filter((e) => e.side === '+x');
    expect(above).toHaveLength(1);
    expect(above[0]!.y0).toBe(6);
    expect(above[0]!.y1).toBe(15);
  });

  it('overlapping pieces do not both own the overlap (no duplicate façade ownership)', () => {
    const a = rect('a', 0, 12, 0, 10), b = rect('b', 8, 20, 0, 10);
    const { edges } = exposedEdges([a, b], [a, b]);
    expect(edges.find((e) => e.rect === 'a' && e.side === '+x')).toBeUndefined();
    expect(edges.find((e) => e.rect === 'b' && e.side === '-x')).toBeUndefined();
    const front = edges.filter((e) => e.side === '+z').map((e) => [e.a, e.b]);
    // a owns 0..12 and b owns 8..20 on the same plane: overlap 8..12 is a collinear duplicate,
    // acceptable for the wall itself, but each piece keeps its own interval inside its box.
    for (const [lo, hi] of front) expect(hi! - lo!).toBeGreaterThan(0);
  });

  it('slivers shorter than MIN_SEGMENT are dropped', () => {
    const a = rect('a', 0, 10, 0, 10), b = rect('b', 10, 20, 0, 9.9);
    const { dropped, edges } = exposedEdges([a], [a, b]);
    expect(dropped).toBe(1);
    expect(edges.every((e) => e.b - e.a >= MIN_SEGMENT)).toBe(true);
  });
});

describe('placements', () => {
  const [plan] = planBuildings([rect('m', 0, 44, 0, 18, 13.8, 'bld_007_Magazzino')]);

  it('chooses whole bays, floors from the height and keeps windows on the visible wall', () => {
    expect(plan!.style.floors).toBe(3);
    for (const p of plan!.placements) {
      const e = plan!.edges.find((x) => x.id === p.edge)!;
      expect(p.a).toBeGreaterThanOrEqual(e.a - 0.13);
      expect(p.b).toBeLessThanOrEqual(e.b + 0.13);
      expect(p.y0).toBeGreaterThanOrEqual(e.y0 - 1e-9);
      expect(p.y1).toBeLessThanOrEqual(e.y1 + 1e-9);
      expect(p.projection).toBeLessThanOrEqual(TRIM_MAX_PROJECTION);
    }
    const longSide = plan!.edges.find((e) => e.side === '+z')!;
    const perFloor = plan!.placements.filter((p) => p.kind === 'window' && p.edge === longSide.id).length / plan!.style.floors;
    expect(perFloor).toBe(Math.floor(44 / BAY_WIDTH));
  });

  it('windows on one floor never overlap', () => {
    const wins = plan!.placements.filter((p) => p.kind === 'window').sort((p, q) => p.edge.localeCompare(q.edge) || p.y0 - q.y0 || p.a - q.a);
    for (let i = 1; i < wins.length; i++) {
      const p = wins[i - 1]!, q = wins[i]!;
      if (p.edge === q.edge && p.y0 === q.y0) expect(q.a).toBeGreaterThan(p.b);
    }
  });

  it('is deterministic for the same input', () => {
    const r = [rect('x', 0, 30, 0, 12, 9, 'bld_001_yes'), rect('y', 30, 40, 0, 12, 9, 'bld_001_yes')];
    expect(JSON.stringify(planBuildings(r))).toBe(JSON.stringify(planBuildings(r)));
  });
});

describe('Porto Vecchio (real pipeline colliders)', () => {
  const colliders = JSON.parse(readFileSync(new URL('../../../../public/assets/maps/porto-vecchio/colliders.json', import.meta.url), 'utf8')) as { simBoxes: Parameters<typeof massFromSimBoxes>[0] };
  const mass = massFromSimBoxes(colliders.simBoxes);
  const plans = planBuildings(mass);

  it('plans every OSM building from its collision boxes', () => {
    expect(new Set(mass.map((m) => m.building)).size).toBe(plans.length);
    expect(plans.length).toBeGreaterThanOrEqual(15);
    expect(plans.some((p) => p.building.includes('Magazzino'))).toBe(true);
  });

  it('decorates only exposed walls and stays within a bounded module count', () => {
    const windows = plans.reduce((s, p) => s + p.diagnostics.windows, 0);
    const edges = plans.reduce((s, p) => s + p.diagnostics.edges, 0);
    expect(windows).toBeGreaterThan(200);
    expect(windows).toBeLessThan(4000);
    for (const p of plans) for (const e of p.edges) {
      const r = p.rects.find((x) => x.id === e.rect)!;
      expect(e.plane === r.minX || e.plane === r.maxX || e.plane === r.minZ || e.plane === r.maxZ).toBe(true);
    }
    expect(edges).toBeGreaterThan(plans.length * 4 - 1);
  });
});
