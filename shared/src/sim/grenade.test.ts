import { describe, expect, it } from 'vitest';
import { GRENADE, blastDamage, pitchForDistance, stepGrenade, throwGrenade, type Grenade } from './grenade';
import { AabbHost, Match, type SimEvent } from './match';
import { applyDamage } from './health';
import { OBJECTIVE } from './objective';
import { PlayerClass } from './etClasses';
import { PORTO_ARDESIA as MAP } from '../map/portoArdesia';
import { v3 } from './vec';
import type { MapDef } from '../map/types';

const DT = 1 / 60;
const EMPTY: MapDef = { ...MAP, boxes: [] };

describe('grenade physics', () => {
  it('flies on an arc, bounces, comes to rest and its fuse ends', () => {
    const g = throwGrenade(1, 0, 0, v3(0, 1.6, 0), 0, 0, v3());
    let maxY = g.pos.y, bounces = 0, t = 0;
    while (t < 6 && g.fuse > 0) { bounces += stepGrenade(g, DT, EMPTY); maxY = Math.max(maxY, g.pos.y); t += DT; }
    expect(maxY).toBeGreaterThan(1.6);
    expect(g.pos.z).toBeLessThan(-8); // thrown forward (-Z)
    expect(bounces).toBeGreaterThan(0);
    expect(Math.hypot(g.vel.x, g.vel.y, g.vel.z)).toBeLessThan(0.6); // at rest by 3 s
    expect(g.pos.y).toBeCloseTo(GRENADE.radius, 1);
    expect(g.fuse).toBeLessThanOrEqual(0);
  });
  it('bounces off a wall instead of passing through', () => {
    const wall: MapDef = { ...MAP, boxes: [{ c: v3(0, 2, -6), s: v3(6, 4, 0.4), material: 'concrete', look: 'concrete' }] };
    const g = throwGrenade(1, 0, 0, v3(0, 1.6, 0), 0, 0, v3());
    for (let t = 0; t < 2; t += DT) stepGrenade(g, DT, wall);
    expect(g.pos.z).toBeGreaterThan(-6 + 0.2 - 0.01); // stayed on the thrower's side
  });
  it('blast damage is full in the lethal radius, falls off, and ends at the blast radius', () => {
    expect(blastDamage(0)).toBe(GRENADE.maxDamage);
    expect(blastDamage(GRENADE.lethalRadius)).toBe(GRENADE.maxDamage);
    expect(blastDamage(4)).toBeGreaterThan(0);
    expect(blastDamage(4)).toBeLessThan(blastDamage(3));
    expect(blastDamage(GRENADE.blastRadius)).toBe(0);
    expect(blastDamage(20)).toBe(0);
  });
  it('pitchForDistance lands near the requested distance on flat ground', () => {
    for (const d of [8, 12, 16]) {
      const pitch = pitchForDistance(d)!;
      const g: Grenade = throwGrenade(1, 0, 0, v3(0, 1.6, 0), 0, pitch, v3());
      let first = -1;
      for (let t = 0; t < 3 && first < 0; t += DT) { if (stepGrenade(g, DT, EMPTY) > 0) first = -g.pos.z; }
      expect(first).toBeGreaterThan(d - 1.5);
      expect(first).toBeLessThan(d + 1.5); // the 0.4 m forward spawn offset
    }
    expect(pitchForDistance(60)).toBeNull();
  });
});

function setup(playerClass?: PlayerClass) {
  const m = new Match(MAP, { seed: 3, attackers: 3, defenders: 3, withPlayer: true, ...(playerClass !== undefined ? { playerClass } : {}) }, new AabbHost(MAP));
  m.brains.clear();
  for (const c of m.combatants) { c.pos = v3(-30, 0.02, 40 - c.id * 3); } // park everyone out of the way
  return m;
}
const place = (m: Match, id: number, x: number, z: number) => { m.combatants[id]!.pos = v3(x, 0.02, z); };
const explodeAt = (m: Match, owner: number, x: number, z: number): SimEvent[] => {
  const c = m.combatants[owner]!;
  const g: Grenade = { id: 99, ownerId: owner, team: c.team, pos: v3(x, 0.1, z), vel: v3(), fuse: 0.001, alive: true, bounces: 0 };
  m.grenades.push(g);
  m.drainEvents();
  m.step(DT);
  return m.drainEvents();
};

describe('grenades in the match', () => {
  it('a throw uses one grenade, then waits for the cooldown and a new press', () => {
    const m = setup();
    const p = m.player!;
    const before = p.grenades;
    p.input.throwGrenade = true;
    m.step(DT);
    expect(p.grenades).toBe(before - 1);
    expect(m.grenades).toHaveLength(1);
    m.step(DT); // still held: no second throw (edge triggered)
    expect(p.grenades).toBe(before - 1);
    p.input.throwGrenade = false; m.step(DT);
    p.input.throwGrenade = true; m.step(DT); // cooldown still running
    expect(p.grenades).toBe(before - 1);
    for (let t = 0; t < GRENADE.cooldownSeconds + 0.1; t += DT) m.step(DT);
    p.input.throwGrenade = false; m.step(DT); p.input.throwGrenade = true; m.step(DT);
    expect(p.grenades).toBe(before - 2);
  });
  it('hurts enemies in range, spares teammates, halves self damage and counts the kill', () => {
    const m = setup();
    place(m, 1, 0, 30); // enemy team? ids: 0..2 attackers, 3..5 defenders
    const enemy = m.combatants[3]!, mate = m.combatants[1]!, thrower = m.combatants[0]!;
    place(m, 3, 0, 31); place(m, 1, 0.5, 31); place(m, 0, 1, 31.5);
    const ev = explodeAt(m, 0, 0, 31);
    const dmg = ev.filter((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage');
    expect(ev.some((e) => e.type === 'explosion')).toBe(true);
    expect(enemy.health.state).toBe('downed');
    expect(thrower.kills).toBe(1);
    expect(mate.health.hp).toBe(100);
    expect(dmg.find((e) => e.victim === 0)!.amount).toBeCloseTo(GRENADE.maxDamage * GRENADE.selfScale, 5);
    expect(dmg.find((e) => e.victim === 1)).toBeUndefined();
  });
  it('a container shields, an open line does not, and range limits apply', () => {
    const m = setup();
    // Container at (-24, 26) spans z 24.78..27.22; blast on one side, targets 5.5 m away on each side.
    place(m, 3, -24, 21.2); // behind the container, line blocked
    place(m, 4, -24, 32.5); // open side
    place(m, 5, -24, 40); // out of range
    explodeAt(m, 0, -24, 27 + 0.5 + 0.01 + 5);
    expect(m.combatants[3]!.health.hp).toBe(100);
    expect(m.combatants[4]!.health.hp).toBeLessThan(100);
    expect(m.combatants[5]!.health.hp).toBe(100);
  });
});

describe('classes in the match', () => {
  it('the player class sets loadout and bots cycle through every class', () => {
    const m = setup(PlayerClass.Engineer);
    expect(m.player!.cls).toBe(PlayerClass.Engineer);
    expect(m.player!.grenades).toBe(2);
    const classes = new Set(m.combatants.filter((c) => c.team === 1).map((c) => c.cls));
    expect(classes.size).toBe(3);
    const big = new Match(MAP, { seed: 1, attackers: 5, defenders: 6, withPlayer: true }, new AabbHost(MAP));
    expect(new Set(big.combatants.filter((c) => c.team === 1).map((c) => c.cls)).size).toBe(5);
  });
  it('spawn refills grenades per class', () => {
    const m = setup(PlayerClass.FieldOps);
    expect(m.player!.grenades).toBe(4);
    m.player!.grenades = 0;
    m.spawn(m.player!);
    expect(m.player!.grenades).toBe(4);
  });
  it('a medic revives a downed teammate by holding interact; others cannot', () => {
    const m = setup();
    const medic = m.combatants.find((c) => c.team === 0 && c.cls === PlayerClass.Medic)!;
    const patient = m.combatants.find((c) => c.team === 0 && c.cls !== PlayerClass.Medic && c.id !== medic.id)!;
    place(m, medic.id, 0, 36); place(m, patient.id, 0.8, 36);
    applyDamage(patient.health, 500, 3);
    expect(patient.health.state).toBe('downed');
    const other = m.combatants.find((c) => c.team === 0 && c.cls !== PlayerClass.Medic && c.id !== patient.id)!;
    place(m, other.id, -0.8, 36);
    other.input.interact = true;
    for (let t = 0; t < REVIVE_TEST_SECONDS; t += DT) m.step(DT);
    expect(patient.health.state).toBe('downed'); // a non-medic cannot
    other.input.interact = false;
    medic.input.interact = true;
    let revived = false;
    for (let t = 0; t < REVIVE_TEST_SECONDS; t += DT) { m.step(DT); if (m.drainEvents().some((e) => e.type === 'revive')) revived = true; }
    expect(revived).toBe(true);
    expect(patient.health.state).toBe('alive');
  });
  it('an engineer plants faster than a soldier', () => {
    const time = (cls: PlayerClass): number => {
      const m = setup(cls);
      m.player!.pos = v3(0, 0.02, m.map.objective.z + 1);
      m.player!.input.interact = true;
      let t = 0;
      while (t < 10 && m.objective.charge !== 'armed') { m.step(DT); t += DT; }
      return t;
    };
    const soldier = time(PlayerClass.Soldier), engineer = time(PlayerClass.Engineer);
    expect(soldier).toBeCloseTo(OBJECTIVE.plantSeconds, 0);
    expect(engineer).toBeLessThan(soldier * 0.7);
  });
  it('a medic regenerates to full health, others stop at the cap', () => {
    const regen = (cls: PlayerClass): number => {
      const m = setup(cls);
      m.player!.health.hp = 20;
      m.player!.health.sinceDamage = 99;
      for (let t = 0; t < 40; t += DT) m.step(DT);
      return m.player!.health.hp;
    };
    expect(regen(PlayerClass.Soldier)).toBeCloseTo(60, 0);
    expect(regen(PlayerClass.Medic)).toBeCloseTo(100, 0);
  });
  it('covert ops carry more sprint stamina', () => {
    expect(setup(PlayerClass.CovertOps).player!.move.staminaMax).toBeGreaterThan(setup(PlayerClass.Soldier).player!.move.staminaMax);
  });
});

describe('bots use grenades', () => {
  it('over a few matches bots throw grenades and nobody keeps a negative count', () => {
    let thrown = 0;
    for (const seed of [1, 2, 3, 4]) {
      const m = new Match(MAP, { seed, attackers: 5, defenders: 6, withPlayer: false }, new AabbHost(MAP));
      for (let t = 0; t < 150 && m.phase === 'playing'; t += DT) {
        m.step(DT);
        for (const e of m.drainEvents()) if (e.type === 'grenade') thrown++;
      }
      for (const c of m.combatants) expect(c.grenades).toBeGreaterThanOrEqual(0);
    }
    expect(thrown).toBeGreaterThan(0);
  });
});

const REVIVE_TEST_SECONDS = 3;
