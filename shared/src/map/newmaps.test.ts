import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AabbHost, Match } from '../sim/match';
import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from './pipeline';

const load = (id: string) => {
  const dir = new URL(`../../../public/assets/maps/${id}/`, import.meta.url);
  const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as T;
  return mapDefFromPipeline(read<PipelineMarkers>('markers.json'), read<PipelineColliders>('colliders.json'), read('navgrid.json'));
};

describe.each(['magazzini-sale', 'scalo-ferroviario'])('new map %s', (id) => {
  const map = load(id);
  it('has buildings, spawns for both teams, an objective and patrols', () => {
    expect(map.spawns[0].length).toBeGreaterThanOrEqual(6);
    expect(map.spawns[1].length).toBeGreaterThanOrEqual(6);
    expect(map.patrols.length).toBeGreaterThan(0);
    expect(map.boxes.length).toBeGreaterThan(30);
  });
  it('a bots-only round produces fighting and ends within the clock', () => {
    const m = new Match(map, { seed: 4, attackers: 5, defenders: 6, withPlayer: false }, new AabbHost(map));
    let shots = 0, damage = 0;
    for (let t = 0; t < 7 * 60 && m.phase === 'playing'; t += 1 / 30) {
      m.step(1 / 30);
      for (const e of m.drainEvents()) { if (e.type === 'shot') shots++; if (e.type === 'damage') damage++; }
    }
    expect(shots).toBeGreaterThan(30);
    expect(damage).toBeGreaterThan(5);
    expect(m.phase).not.toBe('playing');
    for (const c of m.combatants) {
      expect(c.pos.x).toBeGreaterThan(map.bounds.minX - 1); expect(c.pos.x).toBeLessThan(map.bounds.maxX + 1);
      expect(c.pos.z).toBeGreaterThan(map.bounds.minZ - 1); expect(c.pos.z).toBeLessThan(map.bounds.maxZ + 1);
    }
  });
});
