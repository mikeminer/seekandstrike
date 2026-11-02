import { describe, expect, it } from 'vitest';
import { AabbHost, Match } from './match';
import { PORTO_ARDESIA } from '../map/portoArdesia';
import { PlayerClass } from './etClasses';
import { RESUPPLY } from './classStats';
import type { Combatant } from './combatant';

const DT = 1 / 60;
function setup() {
  const m = new Match(PORTO_ARDESIA, { seed: 9, attackers: 5, defenders: 5, withPlayer: true, playerClass: PlayerClass.Soldier }, new AabbHost(PORTO_ARDESIA));
  // Freeze bots so positions stay where the test puts them.
  m.brains.clear();
  const team0 = m.combatants.filter((c) => c.team === 0);
  const ops = team0.find((c) => c.cls === PlayerClass.FieldOps)!;
  const me = m.player!;
  const foe = m.combatants.find((c) => c.team === 1)!;
  return { m, ops, me, foe };
}
const place = (c: Combatant, x: number, z: number): void => { c.pos = { x, y: 0.02, z }; };
const events = (m: Match) => m.drainEvents().filter((e) => e.type === 'resupply');

describe('Field Ops ammunition', () => {
  it('gives a magazine to a nearby teammate running low, then waits the cooldown', () => {
    const { m, ops, me } = setup();
    place(ops, 0, 30); place(me, 1.5, 30);
    me.weapon.reserve = 10; ops.weapon.reserve = 90;
    m.step(DT);
    expect(me.weapon.reserve).toBe(10 + me.weapon.spec.magazine);
    expect(events(m)).toEqual([{ type: 'resupply', giver: ops.id, recipient: me.id, rounds: me.weapon.spec.magazine }]);
    me.weapon.reserve = 10;
    for (let i = 0; i < Math.floor((RESUPPLY.cooldown - 1) / DT); i++) m.step(DT);
    expect(me.weapon.reserve).toBe(10); // still cooling down
    for (let i = 0; i < Math.ceil(1.5 / DT); i++) m.step(DT);
    expect(me.weapon.reserve).toBe(10 + me.weapon.spec.magazine);
  });

  it('never resupplies far teammates, enemies, or players who have enough', () => {
    const { m, ops, me, foe } = setup();
    place(ops, 0, 30); place(me, RESUPPLY.radius + 2, 30); place(foe, 1, 30);
    me.weapon.reserve = 5; foe.weapon.reserve = 5; ops.weapon.reserve = 90;
    m.step(DT);
    expect(me.weapon.reserve).toBe(5);
    expect(foe.weapon.reserve).toBe(5);
    place(me, 1, 30); me.weapon.reserve = me.weapon.spec.magazine * RESUPPLY.lowMagazines;
    m.step(DT);
    expect(me.weapon.reserve).toBe(me.weapon.spec.magazine * RESUPPLY.lowMagazines);
  });

  it('respects the reserve cap', () => {
    const { m, ops, me } = setup();
    const cap = me.weapon.spec.magazine * me.weapon.spec.reserveMagazines;
    place(ops, 0, 30); place(me, 1, 30);
    me.weapon.reserve = Math.min(cap - 5, me.weapon.spec.magazine * RESUPPLY.lowMagazines - 1);
    m.step(DT);
    expect(me.weapon.reserve).toBeLessThanOrEqual(cap);
  });

  it('a Field Ops bot walks to a teammate who is low on ammo', () => {
    const m = new Match(PORTO_ARDESIA, { seed: 9, attackers: 5, defenders: 1, withPlayer: true }, new AabbHost(PORTO_ARDESIA));
    const ops = m.combatants.find((c) => c.team === 0 && c.cls === PlayerClass.FieldOps)!;
    const me = m.player!;
    for (const c of m.combatants) if (c.team === 1) { c.health.state = 'dead'; c.pos = { x: 30, y: 0.02, z: -38 }; }
    place(ops, -10, 34); place(me, 6, 34);
    me.weapon.reserve = 0;
    let given = false;
    for (let i = 0; i < 60 * 12 && !given; i++) { m.step(DT); given = events(m).some((e) => e.type === 'resupply' && e.recipient === me.id); }
    expect(given).toBe(true);
  });
});
