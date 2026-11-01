import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultPatrols, mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from './pipeline';
import { v3 } from '../sim/vec';

const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../../public/assets/maps/porto-vecchio/${file}`, import.meta.url), 'utf8')) as T;

describe('maps without authored patrols', () => {
  it('Porto Vecchio (patrols: null) converts and gets default loops around the objective', () => {
    const markers = load<PipelineMarkers>('markers.json');
    expect(markers.patrols).toBeNull();
    const map = mapDefFromPipeline(markers, load<PipelineColliders>('colliders.json'));
    expect(map.patrols.length).toBe(2);
    for (const loop of map.patrols) {
      expect(loop.length).toBeGreaterThanOrEqual(2);
      for (const i of loop) expect(map.waypoints[i]).toBeDefined();
    }
  });

  it('default loops are deterministic, angle-ordered and skip empty input', () => {
    const o = v3(0, 0, 0);
    const pts = [v3(1, 0, 0), v3(0, 0, 1), v3(-1, 0, 0), v3(0, 0, -1)];
    expect(defaultPatrols(pts, o)).toEqual([[3, 0, 1, 2]]);
    expect(defaultPatrols([], o)).toEqual([]);
    expect(defaultPatrols([v3(5, 0, 5)], o)).toEqual([]);
  });
});

describe('land slabs (where there is ground; water elsewhere)', () => {
  it('Porto Vecchio exposes its four OSM land slabs, tops at y = 0', () => {
    const map = mapDefFromPipeline(load<PipelineMarkers>('markers.json'), load<PipelineColliders>('colliders.json'));
    expect(map.groundSlabs).toHaveLength(4);
    for (const g of map.groundSlabs!) expect(g.c.y + g.s.y / 2).toBeCloseTo(0);
    expect(map.boxes.some((b) => b.c.y + b.s.y / 2 <= 0.001)).toBe(false);
  });

  it('Banchina Est has no land slabs, so its whole area stays walkable as before', () => {
    const dir = new URL('../../../public/assets/maps/banchina-est/', import.meta.url);
    const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as T;
    expect(mapDefFromPipeline(read<PipelineMarkers>('markers.json'), read<PipelineColliders>('colliders.json')).groundSlabs).toBeUndefined();
  });
});
