import { describe, expect, it } from 'vitest';
import { AabbHost, Match, PACE } from './match';
import { PORTO_ARDESIA } from '../map/portoArdesia';
import { skillFor, warmupAimFactor, DEFAULT_SKILL } from './bot';
import { distXZ } from './vec';

const DT = 1 / 60;
const mk = (difficulty: 'recruit' | 'regular' | 'veteran' = 'regular') =>
  new Match(PORTO_ARDESIA, { seed: 5, attackers: 3, defenders: 3, withPlayer: true, difficulty }, new AabbHost(PORTO_ARDESIA));

describe('round pace (less waiting)', () => {
  it('reinforcement waves come every 8/10 s', () => {
    const m = mk();
    expect(m.waves[0].period).toBe(PACE.waveSeconds[0]);
    expect(m.waves[1].period).toBe(PACE.waveSeconds[1]);
    expect(PACE.waveSeconds[0]).toBeLessThanOrEqual(10);
  });

  it('a respawned soldier is protected, ignored by bots, and loses protection when firing', () => {
    const m = mk();
    for (let i = 0; i < 30; i++) m.step(DT);
    const p = m.player!;
    p.health.state = 'dead';
    m.spawn(p);
    expect(p.spawnShield).toBeCloseTo(PACE.spawnShieldSeconds, 5);
    // Shielded: bots never pick the player as a target.
    for (let i = 0; i < 60; i++) { m.step(DT); for (const b of m.brains.values()) expect(b.target).not.toBe(p.id); }
    expect(p.health.hp).toBe(100);
    p.input.fire = true;
    for (let i = 0; i < 5; i++) m.step(DT);
    expect(p.spawnShield).toBe(0);
  });

  it('mid-round respawn picks the spawn spot farthest from the enemies', () => {
    const m = mk();
    for (let i = 0; i < 30; i++) m.step(DT);
    const p = m.player!;
    const foes = m.combatants.filter((o) => o.team !== p.team);
    const spots = m.map.spawns[p.team];
    // Put every enemy on the first spot: the respawn must avoid it.
    for (const f of foes) f.pos = { x: spots[0]!.x, y: 0, z: spots[0]!.z };
    p.health.state = 'dead';
    m.spawn(p);
    const nearest = Math.min(...foes.map((f) => distXZ(f.pos, p.pos)));
    const bestPossible = Math.max(...spots.map((s) => distXZ(s, spots[0]!)));
    expect(nearest).toBeGreaterThanOrEqual(bestPossible - 0.6);
  });

  it('difficulty presets: recruit is slower and less accurate than veteran; warm-up eases the opening', () => {
    const r = skillFor('recruit', false), v = skillFor('veteran', false);
    expect(r.reactionMin).toBeGreaterThan(v.reactionMin);
    expect(r.aimErrorStart).toBeGreaterThan(v.aimErrorStart);
    expect(skillFor('veteran', true)).not.toEqual(DEFAULT_SKILL); // allies keep the regular preset
    expect(warmupAimFactor(0)).toBeCloseTo(1.6);
    expect(warmupAimFactor(25)).toBe(1);
  });
});
