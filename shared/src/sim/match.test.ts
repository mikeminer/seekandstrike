import { describe, expect, it } from 'vitest';
import { AabbHost, Match } from './match';
import { PORTO_ARDESIA } from '../map/portoArdesia';

const DT = 1 / 60;

function run(seed: number, seconds: number) {
  const m = new Match(PORTO_ARDESIA, { seed, attackers: 4, defenders: 4, withPlayer: false }, new AabbHost(PORTO_ARDESIA));
  const counts = { shots: 0, damage: 0, waves: 0, objective: [] as string[] };
  for (let t = 0; t < seconds && m.phase === 'playing'; t += DT) {
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'shot') counts.shots++;
      if (e.type === 'damage') counts.damage++;
      if (e.type === 'wave') counts.waves++;
      if (e.type === 'objective') counts.objective.push(e.event);
    }
  }
  return { m, counts };
}

describe('offline match with bots', () => {
  it('bots patrol, fight, and positions stay finite', () => {
    const { m, counts } = run(7, 90);
    expect(counts.shots).toBeGreaterThan(20);
    expect(counts.damage).toBeGreaterThan(3);
    for (const c of m.combatants) {
      expect(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z)).toBe(true);
      expect(c.pos.x).toBeGreaterThan(-36);
      expect(c.pos.x).toBeLessThan(36);
    }
  });
  it('is deterministic for a seed', () => {
    const a = run(11, 20).m.combatants.map((c) => [c.pos.x, c.pos.z, c.health.hp]);
    const b = run(11, 20).m.combatants.map((c) => [c.pos.x, c.pos.z, c.health.hp]);
    expect(a).toEqual(b);
  });
  it('a full bots-only match resolves with a winner within the match clock', () => {
    const { m } = run(3, 6 * 60 + 40);
    expect(m.phase).not.toBe('playing');
  });
});
