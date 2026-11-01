import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from '@shared/map/pipeline';
import { massFromSimBoxes, planBuildings } from '../architecture/plan';
import { TREE_RULES, footprints, ivyPatches, treeSpots, weedSpots, type Rect2 } from './placement';

const dir = new URL('../../../../public/assets/maps/porto-vecchio/', import.meta.url);
const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as T;
const colliders = read<PipelineColliders>('colliders.json');
const map = mapDefFromPipeline(read<PipelineMarkers>('markers.json'), colliders);
const plans = planBuildings(massFromSimBoxes(colliders.simBoxes));
const edges = plans.flatMap((p) => p.edges);
const land: Rect2[] = map.groundSlabs!.map((g) => ({ minX: g.c.x - g.s.x / 2, maxX: g.c.x + g.s.x / 2, minZ: g.c.z - g.s.z / 2, maxZ: g.c.z + g.s.z / 2 }));
const solids = footprints(map.boxes.map((b) => ({ minX: b.c.x - b.s.x / 2, maxX: b.c.x + b.s.x / 2, minZ: b.c.z - b.s.z / 2, maxZ: b.c.z + b.s.z / 2 })));
const markers = [...map.spawns[0], ...map.spawns[1], map.objective];
const within = (p: { x: number; z: number }, r: Rect2): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

describe('vegetation placement on Porto Vecchio', () => {
  const trees = treeSpots({ bounds: map.bounds, land, solids, markers, seed: 11, variants: 3 });

  it('trees: perimeter band only, on land, clear of solids and of spawns/objective, spaced', () => {
    expect(trees.length).toBeGreaterThan(4);
    expect(trees.length).toBeLessThanOrEqual(TREE_RULES.max);
    const b = map.bounds;
    for (const t of trees) {
      expect(Math.min(t.x - b.minX, b.maxX - t.x, t.z - b.minZ, b.maxZ - t.z)).toBeLessThanOrEqual(TREE_RULES.perimeterBand);
      expect(land.some((l) => within(t, l))).toBe(true);
      for (const s of solids) expect(within(t, s)).toBe(false);
      for (const m of markers) expect(Math.hypot(m.x - t.x, m.z - t.z)).toBeGreaterThanOrEqual(TREE_RULES.clearOfMarkers);
      for (const o of trees) if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThanOrEqual(TREE_RULES.spacing);
    }
  });

  it('trees spread over the perimeter instead of filling the first side scanned', () => {
    const b = map.bounds;
    const side = (t: { x: number; z: number }): string => {
      const d = { W: t.x - b.minX, E: b.maxX - t.x, N: t.z - b.minZ, S: b.maxZ - t.z };
      return (Object.entries(d) as [string, number][]).sort((p, q) => p[1] - q[1])[0]![0];
    };
    expect(new Set(trees.map(side)).size).toBeGreaterThanOrEqual(3);
  });

  it('weeds: on land, never inside a box, deterministic', () => {
    const w = weedSpots({ edges, land, solids, seed: 5 });
    expect(w.length).toBeGreaterThan(1000);
    for (const p of w) {
      expect(land.some((l) => within(p, l))).toBe(true);
      for (const s of solids) expect(p.x > s.minX + 0.02 && p.x < s.maxX - 0.02 && p.z > s.minZ + 0.02 && p.z < s.maxZ - 0.02).toBe(false);
    }
    expect(JSON.stringify(weedSpots({ edges, land, solids, seed: 5 }))).toBe(JSON.stringify(w));
  });

  it('ivy: only on shady ground-level façades, inside the wall', () => {
    const ivy = ivyPatches({ edges, seed: 3, shadySides: ['+x', '-z'] });
    expect(ivy.length).toBeGreaterThan(5);
    for (const p of ivy) {
      expect(['+x', '-z']).toContain(p.edge.side);
      expect(p.center - p.width / 2).toBeGreaterThanOrEqual(p.edge.a);
      expect(p.center + p.width / 2).toBeLessThanOrEqual(p.edge.b);
      expect(p.height).toBeLessThanOrEqual(p.edge.y1);
    }
  });
});
