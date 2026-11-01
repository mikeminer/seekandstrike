import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AabbHost, Match } from '../sim/match';
import { PORTO_ARDESIA } from './portoArdesia';
import { mapDefFromPipeline } from './pipeline';
import { findGridPath, snapToGrid } from './navgrid';
import { blockedAt } from './query';
import type { MapBox, MapDef } from './types';

const DIR = new URL('../../../public/assets/maps/banchina-est/', import.meta.url);
const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T;
const build = (withGrid: boolean): MapDef =>
  mapDefFromPipeline(load('markers.json'), load('colliders.json'), withGrid ? load('navgrid.json') : undefined);

const key = (b: MapBox): string =>
  [b.c.x, b.c.y, b.c.z, b.s.x, b.s.y, b.s.z].map((v) => v.toFixed(3)).join(',') + b.material + b.look + (b.shell ?? '') + (b.fill ?? '');

const DT = 1 / 60;
function run(map: MapDef, seed: number, seconds: number) {
  const m = new Match(map, { seed, attackers: 4, defenders: 4, withPlayer: false }, new AabbHost(map));
  let shots = 0, damage = 0;
  for (let t = 0; t < seconds && m.phase === 'playing'; t += DT) {
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'shot') shots++;
      if (e.type === 'damage') damage++;
    }
  }
  return { m, shots, damage, pos: m.combatants.map((c) => [c.pos.x, c.pos.z, c.health.hp] as const) };
}

describe('map pipeline output as MapDef', () => {
  const map = build(true);

  it('reproduces the hand-written Porto di Ardesia map exactly (except the nav grid)', () => {
    expect(map.boxes.map(key).sort()).toEqual(PORTO_ARDESIA.boxes.map(key).sort());
    expect(map.id).toBe(PORTO_ARDESIA.id);
    expect(map.bounds).toEqual(PORTO_ARDESIA.bounds);
    expect(map.spawns).toEqual(PORTO_ARDESIA.spawns);
    expect(map.spawnYaw[0]).toBeCloseTo(PORTO_ARDESIA.spawnYaw[0], 3);
    expect(map.spawnYaw[1]).toBeCloseTo(PORTO_ARDESIA.spawnYaw[1], 3);
    expect(map.objective).toEqual(PORTO_ARDESIA.objective);
    expect(map.waypoints).toEqual(PORTO_ARDESIA.waypoints);
    expect(map.patrols).toEqual(PORTO_ARDESIA.patrols);
    expect(map.waterLevel).toBe(PORTO_ARDESIA.waterLevel);
    expect(map.navGrid).toBeDefined();
  });

  it('same seed gives identical sim results as the hand-written map (no grid)', () => {
    const a = run(build(false), 7, 60);
    const b = run(PORTO_ARDESIA, 7, 60);
    expect(a.shots).toBe(b.shots);
    expect(a.damage).toBe(b.damage);
    // Box coordinates in the JSON are rounded (~1e-7 m), so compare positions to 1 mm.
    expect(a.pos.length).toBe(b.pos.length);
    a.pos.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(b.pos[i]![k]!, 3)));
  });

  it('grid paths join both spawns to the objective with sane lengths', () => {
    const g = map.navGrid!;
    for (const [team, max] of [[0, 90], [1, 50]] as const) {
      const p = findGridPath(g, map.spawns[team][0]!, map.objective);
      expect(p, `team ${team}`).not.toBeNull();
      expect(p!.length).toBeGreaterThan(10);
      expect(p!.length).toBeLessThan(max);
      expect(p!.points.length).toBeGreaterThan(1);
      for (const pt of p!.points) expect(blockedAt(map, { x: pt.x, y: 0, z: pt.z }, 0.2), 'path point inside geometry').toBe(false);
    }
  });

  it('every spawn and waypoint snaps to a reachable cell', () => {
    const g = map.navGrid!;
    for (const p of [...map.spawns[0], ...map.spawns[1], ...map.waypoints]) expect(snapToGrid(g, p.x, p.z, p.y)).not.toBeNull();
  });

  it('bots using the grid fight, stay finite and the run is deterministic', () => {
    const a = run(map, 7, 90);
    const b = run(map, 7, 90);
    expect(a.shots).toBeGreaterThan(20);
    for (const [x, z] of a.pos) { expect(Number.isFinite(x)).toBe(true); expect(Number.isFinite(z)).toBe(true); }
    expect(a.pos).toEqual(b.pos);
    expect(a.shots).toBe(b.shots);
  });
});
