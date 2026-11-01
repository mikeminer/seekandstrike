import { describe, expect, it } from 'vitest';
import { createMoveState, MOVE, stepMovement, type MoveInput } from './movement';
import { flightTo, spawnProjectile, stepProjectile, type ProjectileImpact, type RayHit } from './ballistics';
import { createWeapon, currentSpread, RIFLE_R30, roundsLoaded, startReload, tickWeapon, tryFire } from './weapons';
import { applyDamage, createHealth, HEALTH, revive, tickHealth, WaveClock } from './health';
import { createObjective, OBJECTIVE, tickObjective } from './objective';
import { Rng } from './rng';
import { v3 } from './vec';

const DT = 1 / 60;
const input = (o: Partial<MoveInput> = {}): MoveInput => ({ moveX: 0, moveY: 0, sprint: false, jump: false, aim: false, wantStance: 'stand', ...o });

function runMove(seconds: number, inp: MoveInput, s = createMoveState()) {
  for (let t = 0; t < seconds; t += DT) {
    stepMovement(s, inp, 0, DT);
    s.grounded = true; // flat ground
    if (s.vel.y < 0) s.vel.y = 0;
  }
  return s;
}

describe('movement', () => {
  it('accelerates to the jog speed and no faster', () => {
    const s = runMove(2, input({ moveY: 1 }));
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(MOVE.runSpeed, 1);
    expect(s.vel.z).toBeLessThan(0); // yaw 0 faces -Z
  });
  it('sprint is faster but drains stamina and then stops', () => {
    const s = runMove(1, input({ moveY: 1, sprint: true }));
    expect(s.sprinting).toBe(true);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeGreaterThan(MOVE.runSpeed + 1);
    runMove(MOVE.staminaMax - 1 + 0.3, input({ moveY: 1, sprint: true }), s);
    expect(s.sprinting).toBe(false);
    expect(s.stamina).toBeLessThan(MOVE.staminaMinToSprint);
  });
  it('crouch and prone are progressively slower; no sprint while aiming', () => {
    const c = runMove(2, input({ moveY: 1, wantStance: 'crouch' }));
    const p = runMove(3, input({ moveY: 1, wantStance: 'prone' }));
    expect(Math.hypot(c.vel.x, c.vel.z)).toBeCloseTo(MOVE.crouchSpeed, 1);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(MOVE.proneSpeed, 1);
    const a = runMove(1, input({ moveY: 1, sprint: true, aim: true }));
    expect(a.sprinting).toBe(false);
  });
  it('friction stops the soldier', () => {
    const s = runMove(2, input({ moveY: 1 }));
    runMove(1, input(), s);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeLessThan(0.01);
  });
  it('jump reaches a realistic ~0.5 m apex', () => {
    const s = createMoveState();
    let y = 0, maxY = 0;
    const d0 = stepMovement(s, input({ jump: true }), 0, DT);
    y += d0.y;
    for (let i = 0; i < 120 && y > 0; i++) {
      const d = stepMovement(s, input(), 0, DT);
      y += d.y; maxY = Math.max(maxY, y);
    }
    expect(maxY).toBeGreaterThan(0.45);
    expect(maxY).toBeLessThan(0.65);
  });
});

describe('ballistics', () => {
  const spec = RIFLE_R30.bullet;
  it('has realistic drop, time of flight and velocity loss', () => {
    const at100 = flightTo(spec, 100);
    const at300 = flightTo(spec, 300);
    expect(at100.time).toBeGreaterThan(0.105);
    expect(at100.time).toBeLessThan(0.13);
    expect(at100.drop).toBeGreaterThan(0.04);
    expect(at100.drop).toBeLessThan(0.1);
    expect(at300.drop).toBeGreaterThan(0.45);
    expect(at300.speed).toBeLessThan(at100.speed);
    expect(at300.speed).toBeGreaterThan(550);
  });
  it('does not tunnel through a thin wall at full speed', () => {
    const wallX = 50;
    const ray = (o: { x: number }, d: { x: number }, max: number): RayHit | null => {
      if (d.x <= 0) return null;
      const t = (wallX - o.x) / d.x;
      return t >= 0 && t <= max ? { distance: t, point: v3(wallX, 1, 0), normal: v3(-1, 0, 0), material: 'concrete', thickness: 0.01 } : null;
    };
    const p = spawnProjectile(1, 0, 0, v3(0, 1, 0), v3(1, 0, 0), spec);
    const out: ProjectileImpact[] = [];
    for (let i = 0; i < 30 && p.alive; i++) stepProjectile(p, spec, DT, ray as never, out);
    expect(out.length).toBe(1);
    expect(out[0]!.penetrated).toBe(false);
    expect(p.pos.x).toBeCloseTo(wallX, 3);
  });
  it('penetrates thin wood with reduced energy', () => {
    let hits = 0;
    const ray = (o: { x: number }, d: { x: number }, max: number): RayHit | null => {
      const t = (10 - o.x) / d.x;
      if (hits === 0 && t >= 0 && t <= max) { hits++; return { distance: t, point: v3(10, 1, 0), normal: v3(-1, 0, 0), material: 'wood', thickness: 0.05 }; }
      return null;
    };
    const p = spawnProjectile(1, 0, 0, v3(0, 1, 0), v3(1, 0, 0), spec);
    const out: ProjectileImpact[] = [];
    stepProjectile(p, spec, 0.05, ray as never, out);
    expect(out[0]!.penetrated).toBe(true);
    expect(p.alive).toBe(true);
    expect(p.energyScale).toBeLessThan(1);
    expect(p.pos.x).toBeGreaterThan(10);
  });
});

describe('weapon', () => {
  const ctx = { stance: 'stand' as const, moving: 0, airborne: false };
  it('fires at the rated cadence and empties a 30-round magazine', () => {
    const w = createWeapon(RIFLE_R30);
    const rng = new Rng(1);
    let shots = 0;
    for (let t = 0; t < 1; t += DT) { tickWeapon(w, DT, false); if (tryFire(w, ctx, rng)) shots++; }
    // 720 rpm = 12 rps; with 60 Hz quantisation the cadence is 10-12 rps.
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(12);
    for (let t = 0; t < 5; t += DT) { tickWeapon(w, DT, false); if (tryFire(w, ctx, rng)) shots++; }
    expect(shots).toBe(30);
    expect(roundsLoaded(w)).toBe(0);
  });
  it('empty reload is slower than tactical and chambers a round', () => {
    const w = createWeapon(RIFLE_R30);
    const rng = new Rng(2);
    tickWeapon(w, DT, false); tryFire(w, ctx, rng);
    expect(startReload(w)).toBe(true);
    expect(w.reloadTotal).toBe(RIFLE_R30.reloadTacticalSeconds);
    for (let t = 0; t < 3; t += DT) tickWeapon(w, DT, false);
    expect(roundsLoaded(w)).toBe(31); // 30 + 1 in the chamber
    const e = createWeapon(RIFLE_R30);
    e.inMag = 0; e.chambered = false;
    startReload(e);
    expect(e.reloadTotal).toBe(RIFLE_R30.reloadEmptySeconds);
    expect(tryFire(e, ctx, rng)).toBeNull();
  });
  it('aiming tightens the cone; recoil kicks upward', () => {
    const w = createWeapon(RIFLE_R30);
    const hip = currentSpread(w, ctx);
    for (let t = 0; t < 0.5; t += DT) tickWeapon(w, DT, true);
    expect(currentSpread(w, ctx)).toBeLessThan(hip / 5);
    const s = tryFire(w, ctx, new Rng(3))!;
    expect(s.kickPitch).toBeGreaterThan(0);
  });
});

describe('health and waves', () => {
  it('goes down at 0 HP, can be revived, finished or bleed out', () => {
    const h = createHealth();
    expect(applyDamage(h, 60, 1)).toBe('hurt');
    expect(applyDamage(h, 60, 1)).toBe('downed');
    expect(revive(h)).toBe(true);
    expect(h.hp).toBe(HEALTH.reviveHealth);
    applyDamage(h, 100, 1);
    expect(applyDamage(h, HEALTH.finishDamage, 1)).toBe('killed');
    const b = createHealth();
    applyDamage(b, 200, 1);
    for (let t = 0; t < HEALTH.bleedOutSeconds + 0.1; t += DT) tickHealth(b, DT);
    expect(b.state).toBe('dead');
  });
  it('wave clock fires every period', () => {
    const w = new WaveClock(20);
    let n = 0;
    for (let t = 0; t < 61; t += 0.5) if (w.tick(0.5)) n++;
    expect(n).toBe(3);
  });
});

describe('objective', () => {
  it('plant then detonate = attackers win', () => {
    const o = createObjective();
    for (let t = 0; t < OBJECTIVE.plantSeconds + 0.1; t += DT) tickObjective(o, { attackersInteracting: [0], defendersInteracting: [] }, DT);
    expect(o.charge).toBe('armed');
    for (let t = 0; t < OBJECTIVE.fuseSeconds + 0.1; t += DT) tickObjective(o, { attackersInteracting: [], defendersInteracting: [] }, DT);
    expect(o.phase).toBe('attackersWin');
  });
  it('interrupted plant resets; defuse returns the site to idle', () => {
    const o = createObjective();
    tickObjective(o, { attackersInteracting: [0], defendersInteracting: [] }, 1);
    tickObjective(o, { attackersInteracting: [], defendersInteracting: [] }, DT);
    expect(o.charge).toBe('idle');
    for (let t = 0; t < OBJECTIVE.plantSeconds + 0.1; t += DT) tickObjective(o, { attackersInteracting: [0], defendersInteracting: [] }, DT);
    let ev = null;
    for (let t = 0; t < OBJECTIVE.defuseSeconds + 0.1 && ev !== 'defused'; t += DT) ev = tickObjective(o, { attackersInteracting: [], defendersInteracting: [5] }, DT);
    expect(ev).toBe('defused');
    expect(o.charge).toBe('idle');
    expect(o.phase).toBe('playing');
  });
  it('clock expiry without a live charge = defenders win; armed charge goes to overtime', () => {
    const o = createObjective();
    o.clock = 1;
    tickObjective(o, { attackersInteracting: [], defendersInteracting: [] }, 1.1);
    expect(o.phase).toBe('defendersWin');
    const a = createObjective();
    a.charge = 'armed'; a.fuse = 5; a.clock = 0.5;
    tickObjective(a, { attackersInteracting: [], defendersInteracting: [] }, 1);
    expect(a.phase).toBe('playing');
  });
});
