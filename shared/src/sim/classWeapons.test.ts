import { describe, expect, it } from 'vitest';
import { AabbHost, Match, type SimEvent } from './match';
import { PORTO_ARDESIA } from '../map/portoArdesia';
import { PlayerClass } from './etClasses';
import { LAUNCHER_LR1, RIFLE_R30, SNIPER_SR7, SWITCH_SECONDS } from './weapons';
import { createCombatant } from './combatant';
import { parseCmd } from '../protocol';

const DT = 1 / 60;
const mk = (cls: PlayerClass, defenders = 3) => {
  const m = new Match(PORTO_ARDESIA, { seed: 3, attackers: 3, defenders, withPlayer: true, playerClass: cls }, new AabbHost(PORTO_ARDESIA));
  m.brains.clear(); // bots stand still: the test drives the player
  return m;
};

describe('class weapons', () => {
  it('loadouts: Covert Ops carry the sniper rifle, Soldiers a rifle and a launcher, others the rifle', () => {
    expect(createCombatant(0, 0, false, 'x', PlayerClass.CovertOps).weapons.map((w) => w.spec.id)).toEqual([SNIPER_SR7.id]);
    expect(createCombatant(0, 0, false, 'x', PlayerClass.Soldier).weapons.map((w) => w.spec.id)).toEqual([RIFLE_R30.id, LAUNCHER_LR1.id]);
    expect(createCombatant(0, 0, false, 'x', PlayerClass.Medic).weapons.map((w) => w.spec.id)).toEqual([RIFLE_R30.id]);
  });

  it('the sniper rifle takes down with one shot to the head and (at full energy) to the chest', () => {
    expect(SNIPER_SR7.bullet.baseDamage * SNIPER_SR7.zoneMultiplier.head).toBeGreaterThan(100);
    expect(SNIPER_SR7.bullet.baseDamage * SNIPER_SR7.zoneMultiplier.torso).toBeGreaterThanOrEqual(100);
    expect(60 / SNIPER_SR7.roundsPerMinute).toBeGreaterThan(1); // bolt action
    expect(SNIPER_SR7.adsFov).toBeLessThan(20);
  });

  it('a Soldier switches to the launcher and back with one press each; the new weapon needs a moment', () => {
    const m = mk(PlayerClass.Soldier);
    const p = m.player!;
    p.input.switchWeapon = true; m.step(DT);
    expect(p.slot).toBe(1);
    expect(p.weapon.spec.id).toBe(LAUNCHER_LR1.id);
    expect(p.weapon.cooldown).toBeGreaterThan(SWITCH_SECONDS - 0.05);
    m.step(DT); // still held: no second switch
    expect(p.slot).toBe(1);
    p.input.switchWeapon = false; m.step(DT);
    p.input.switchWeapon = true; m.step(DT);
    expect(p.slot).toBe(0);
  });

  it('a rocket flies, hits a soldier in its path and blasts it', () => {
    const m = mk(PlayerClass.Soldier, 1);
    const p = m.player!;
    const foe = m.combatants.find((c) => c.team === 1)!;
    for (const c of m.combatants) if (c !== p && c !== foe) c.pos = { x: 30, y: 0.02, z: -38 }; // out of the way
    p.pos = { x: 0, y: 0.02, z: 30 }; p.yaw = 0; p.pitch = -0.05;
    foe.pos = { x: 0, y: 0.02, z: 18 };
    p.input.switchWeapon = true; m.step(DT); p.input.switchWeapon = false;
    for (let i = 0; i < 40; i++) m.step(DT); // weapon comes up
    m.drainEvents();
    p.input.fire = true; m.step(DT); p.input.fire = false;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 60; i++) { m.step(DT); evs.push(...m.drainEvents()); }
    expect(evs.some((e) => e.type === 'explosion')).toBe(true);
    const hit = evs.find((e) => e.type === 'damage' && e.victim === foe.id);
    expect(hit && hit.type === 'damage' && hit.zone).toBe('rocket');
    expect(foe.health.state).not.toBe('alive');
  });

  it('bots use their class weapons in a bots-only round (rockets from Soldiers, sniper shots from Covert Ops)', () => {
    const m = new Match(PORTO_ARDESIA, { seed: 12, attackers: 5, defenders: 5, withPlayer: false }, new AabbHost(PORTO_ARDESIA));
    let rockets = 0, sniperShots = 0;
    for (let t = 0; t < 240 && m.phase === 'playing'; t += DT) {
      m.step(DT);
      for (const e of m.drainEvents()) {
        if (e.type === 'rocket') rockets++;
        if (e.type === 'shot' && m.combatants[e.shooter]!.cls === PlayerClass.CovertOps) sniperShots++;
      }
    }
    expect(rockets).toBeGreaterThan(0);
    expect(sniperShots).toBeGreaterThan(0);
  });

  it('online commands carry the weapon switch', () => {
    const c = parseCmd({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, stance: 0, weapon: true });
    expect(c?.weapon).toBe(true);
    expect(parseCmd({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, stance: 0, weapon: 'yes' })).toBeNull();
  });
});
