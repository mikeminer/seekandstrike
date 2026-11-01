import { describe, expect, it } from 'vitest';
import { PORTO_ARDESIA as M } from './portoArdesia';
import { blockedAt, buildNavGraph, coverPoints, findPath, lineOfSight, nearestNode, raycastStatic } from './query';
import { v3 } from '../sim/vec';
import { RIFLE_R30 } from '../sim/weapons';
import { spawnProjectile, stepProjectile, type ProjectileImpact } from '../sim/ballistics';
import type { MapDef } from './types';

describe('Porto di Ardesia map data', () => {
  it('waypoints and spawns are not inside geometry', () => {
    for (const [i, w] of M.waypoints.entries()) expect(blockedAt(M, w, 0.35), `waypoint ${i}`).toBe(false);
    for (const team of M.spawns) for (const s of team) expect(blockedAt(M, s, 0.35)).toBe(false);
  });
  it('nav graph connects both spawns to the objective', () => {
    const g = buildNavGraph(M);
    const goal = nearestNode(g, M, M.objective);
    for (const team of M.spawns) {
      const path = findPath(g, nearestNode(g, M, team[0]!), goal);
      expect(path.length).toBeGreaterThan(1);
    }
    // Every waypoint is reachable.
    const start = nearestNode(g, M, M.spawns[0][0]!);
    for (let i = 0; i < g.nodes.length; i++) expect(findPath(g, start, i).length, `node ${i}`).toBeGreaterThan(0);
  });
  it('raycasts hit walls and ground; LOS is blocked by the bunker', () => {
    const h = raycastStatic(M, v3(0, 1.5, 10), v3(0, 0, -1), 100);
    expect(h).not.toBeNull();
    const g = raycastStatic(M, v3(0, 1.5, 30), v3(0, -1, 0), 10)!;
    expect(g.material).toBe('asphalt');
    expect(lineOfSight(M, v3(0, 1.5, -15), v3(0, 1.5, -29.5))).toBe(false);
  });
  it('provides cover points', () => {
    expect(coverPoints(M).length).toBeGreaterThan(30);
  });
});

describe('bullet penetration by material', () => {
  const spec = RIFLE_R30.bullet;
  const one = (box: MapDef['boxes'][number]): MapDef => ({ ...M, boxes: [box] });
  const shoot = (map: MapDef): { out: ProjectileImpact[]; alive: boolean; x: number } => {
    const p = spawnProjectile(1, 0, 0, v3(0, 1.2, 0), v3(1, 0, 0), spec);
    const out: ProjectileImpact[] = [];
    const ray = (o: Parameters<typeof raycastStatic>[1], d: Parameters<typeof raycastStatic>[2], max: number) => raycastStatic(map, o, d, max);
    for (let i = 0; i < 20 && p.alive && p.pos.x < 20; i++) stepProjectile(p, spec, 1 / 60, ray, out, 0);
    return { out, alive: p.alive, x: p.pos.x };
  };
  it('a loaded shipping container stops a rifle round', () => {
    const c = M.boxes.find((b) => b.material === 'sheetMetal')!;
    expect(c.fill).toBeGreaterThan(0);
    const r = shoot(one({ ...c, c: v3(10 + c.s.x / 2, c.s.y / 2, 0) }));
    expect(r.out.length).toBe(1);
    expect(r.out[0]!.penetrated).toBe(false);
    expect(r.alive).toBe(false);
  });
  it('a wooden crate is shot through and the round exits beyond the far face', () => {
    const r = shoot(one({ c: v3(10.6, 0.6, 0), s: v3(1.2, 1.2, 1.2), material: 'wood', look: 'crate', shell: 0.04 }));
    expect(r.out[0]!.penetrated).toBe(true);
    expect(r.out.length).toBe(1);
    expect(r.x).toBeGreaterThan(11.2);
  });
  it('concrete and steel plate block', () => {
    for (const material of ['concrete', 'metal'] as const) {
      const r = shoot(one({ c: v3(10.15, 1, 0), s: v3(0.3, 2, 2), material, look: 'concrete' }));
      expect(r.out.length).toBe(1);
      expect(r.out[0]!.penetrated).toBe(false);
    }
  });
});
