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
