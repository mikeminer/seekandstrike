import { describe, expect, it } from 'vitest';
import { AabbHost, Match, MAX_REWIND_SECONDS } from './match';
import { spawnProjectile } from './ballistics';
import { RIFLE_R30 } from './weapons';
import { PORTO_ARDESIA as MAP } from '../map/portoArdesia';
import { v3, type Vec3 } from './vec';

const DT = 1 / 60;

/** Shooter 8 m south of a target that runs sideways (+x) at the sim's jog speed; returns the recorded target track. */
function scene() {
  const m = new Match(MAP, { seed: 3, attackers: 2, defenders: 2, withPlayer: false, lagCompensation: true }, new AabbHost(MAP));
  m.brains.clear();
  for (const c of m.combatants) { c.isBot = false; c.pos = v3(-30, 0.02, 40 - c.id * 3); }
  const shooter = m.combatants[0]!, target = m.combatants[2]!;
  shooter.pos = v3(0, 0.02, 36);
  target.pos = v3(-3, 0.02, 28);
  const track: { t: number; pos: Vec3 }[] = [];
  for (let i = 0; i < 60; i++) {
    target.input.moveX = 1; // right at yaw 0 is +x
    m.step(DT);
    track.push({ t: m.time, pos: { ...target.pos } });
  }
  return { m, shooter, target, track };
}
const chest = (p: Vec3): Vec3 => v3(p.x, p.y + 1.25, p.z);
const dirTo = (from: Vec3, to: Vec3): Vec3 => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return v3(d.x / l, d.y / l, d.z / l);
};

describe('lag compensation (rewound hit tests)', () => {
  it('the target really moved: the old and current positions are far apart', () => {
    const { target, track } = scene();
    const old = track[track.length - 13]!; // 0.2 s ago
    expect(Math.hypot(target.pos.x - old.pos.x, target.pos.z - old.pos.z)).toBeGreaterThan(0.7);
  });

  it('a ray aimed where the target was hits when rewound to that time, and misses against the present', () => {
    const { m, shooter, track } = scene();
    const old = track[track.length - 13]!;
    const eye = v3(shooter.pos.x, shooter.pos.y + 1.63, shooter.pos.z);
    const dir = dirTo(eye, chest(old.pos));
    const rewound = m.raycast(eye, dir, 60, shooter.id, old.t);
    expect(rewound?.targetId).toBe(2);
    expect(m.raycast(eye, dir, 60, shooter.id)?.targetId).toBeUndefined();
  });

  it('a bullet fired by a lagging shooter hits where the shooter saw the target; the same bullet without lag misses', () => {
    for (const lag of [0.2, 0]) {
      const { m, shooter, target, track } = scene();
      const old = track[track.length - 13]!;
      const eye = v3(shooter.pos.x, shooter.pos.y + 1.63, shooter.pos.z);
      const p = spawnProjectile(1, shooter.id, shooter.team, eye, dirTo(eye, chest(old.pos)), RIFLE_R30.bullet);
      if (lag > 0) p.lag = lag;
      m.projectiles.push(p);
      m.step(DT);
      m.step(DT);
      if (lag > 0) expect(target.health.hp).toBeLessThan(100);
      else expect(target.health.hp).toBe(100);
    }
  });

  it('a bullet flying in the present still hits a target that has not moved (no regression for lag 0)', () => {
    const { m, shooter, target } = scene();
    target.input.moveX = 0;
    for (let i = 0; i < 60; i++) m.step(DT); // settle
    const eye = v3(shooter.pos.x, shooter.pos.y + 1.63, shooter.pos.z);
    m.projectiles.push(spawnProjectile(1, shooter.id, shooter.team, eye, dirTo(eye, chest(target.pos)), RIFLE_R30.bullet));
    m.step(DT); m.step(DT);
    expect(target.health.hp).toBeLessThan(100);
  });

  it('rewound hits use the target pose of that time: a target that died since is still hittable (favours the shooter)', () => {
    const { m, shooter, target, track } = scene();
    const old = track[track.length - 7]!; // 0.1 s ago
    target.health.state = 'dead'; // dies now, after the shooter's view time
    const eye = v3(shooter.pos.x, shooter.pos.y + 1.63, shooter.pos.z);
    const dir = dirTo(eye, chest(old.pos));
    expect(m.raycast(eye, dir, 60, shooter.id, old.t)?.targetId).toBe(2);
    expect(m.raycast(eye, dir, 60, shooter.id)?.targetId).toBeUndefined();
  });

  it('never rewinds beyond the recorded history', () => {
    const { m, shooter, track } = scene();
    const eye = v3(shooter.pos.x, shooter.pos.y + 1.63, shooter.pos.z);
    // Asking for a time long before the history uses the oldest recorded pose instead of failing.
    expect(() => m.raycast(eye, dirTo(eye, chest(track[0]!.pos)), 60, shooter.id, -100)).not.toThrow();
    expect(MAX_REWIND_SECONDS).toBeLessThanOrEqual(0.5); // and the history (0.7 s) always covers it
  });
});
