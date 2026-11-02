import { describe, expect, it } from 'vitest';
import type { Snapshot, SnapPlayer } from '@shared/protocol';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { RoomSim } from '../../../server/src/room/roomSim';
import { Mirror } from './mirror';

const player = (id: number, extra: Partial<SnapPlayer> = {}): SnapPlayer =>
  ({ id, tm: 1, cl: 0, n: `P${id}`, x: 0, y: 0, z: 0, yw: 0, pt: 0, st: 0, lf: 0, hp: 100, sp: 0, hu: 1, k: 0, d: 0, ...extra });
const snap = (players: SnapPlayer[], ev: Snapshot['ev'] = []): Snapshot => ({
  t: 'snap', tick: 1, time: 1, ack: 0, you: 0,
  self: { hp: 100, mag: 30, reserve: 120, grenades: 3, stamina: 8, reloading: false, mv: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yw: 0, pt: 0, st: 0, stt: 0, g: 1, sp: 0 } },
  players, grenades: [], obj: { charge: 'idle', progress: 0, fuse: 0, clock: 360, phase: 'playing' }, ev,
});

describe('mirror: other players\' weapon state', () => {
  it('reload and aim flags drive the animation inputs of another soldier and play a reload sound once', () => {
    const mir = new Mirror(PORTO_ARDESIA, 0);
    const base = [player(0), player(1)];
    expect(mir.applyState(snap(base)).filter((e) => e.type === 'reload')).toHaveLength(0);

    const evs = mir.applyState(snap([player(0), player(1, { rl: 1, ad: 1 })]));
    expect(evs.filter((e) => e.type === 'reload')).toEqual([{ type: 'reload', who: 1 }]);
    const other = mir.match.combatants[1]!;
    expect(other.weapon.phase).toBe('reloading');
    expect(other.input.aim).toBe(true);

    // Still reloading in the next snapshot: no second sound.
    expect(mir.applyState(snap([player(0), player(1, { rl: 1 })])).filter((e) => e.type === 'reload')).toHaveLength(0);
    expect(other.input.aim).toBe(false);

    mir.applyState(snap(base));
    expect(other.weapon.phase).toBe('ready');
  });

  it('every shooter advances the shot counter (fire clip), only the own one gets recoil', () => {
    const mir = new Mirror(PORTO_ARDESIA, 0);
    const shot = (by: number): Snapshot['ev'][number] => ({ e: 'shot', by, x: 0, y: 1.5, z: 0, dx: 0, dy: 0, dz: 1 });
    mir.applyState(snap([player(0), player(1)], [shot(1), shot(0)]));
    expect(mir.match.combatants[1]!.weapon.shotsFired).toBe(1);
    expect(mir.match.combatants[1]!.kickPitch).toBe(0);
    expect(mir.match.combatants[0]!.kickPitch).toBeGreaterThan(0);
  });
});

describe('mirror: grenade bounce sound', () => {
  it('reports a bounce when a grenade stops falling and rises again, not while it falls or rests', () => {
    const mir = new Mirror(PORTO_ARDESIA, 0);
    const at = (y: number) => [{ id: 7, x: 0, y, z: 0 }];
    expect(mir.applyGrenades(at(2))).toEqual([]);
    expect(mir.applyGrenades(at(1))).toEqual([]);
    expect(mir.applyGrenades(at(0.1))).toEqual([]);
    const up = mir.applyGrenades(at(0.5));
    expect(up).toHaveLength(1);
    expect(up[0]!.type).toBe('grenadeBounce');
    expect(mir.applyGrenades(at(0.9))).toEqual([]);
    mir.applyGrenades(at(0.3));
    expect(mir.applyGrenades(at(0.1))).toEqual([]);
    expect(mir.applyGrenades(at(0.1))).toEqual([]);
  });
});

describe('server snapshot flags', () => {
  it('omits rl/ad when idle so frames stay small', () => {
    const room = new RoomSim({ map: PORTO_ARDESIA, seed: 3, now: () => 0, token: () => 't1', graceMs: 20_000 });
    const seat = room.join('Test', 0 as never);
    expect(seat).not.toBeNull();
    const s = [...room.snapshots().values()][0]!;
    const me = s.players.find((p) => p.hu === 1)!;
    expect('rl' in me).toBe(false);
    expect('ad' in me).toBe(false);
  });
});

describe('mirror: own aim-down-sights blend (online)', () => {
  it('reaches 1 and holds it frame after frame while aiming (regression: it flickered 1 ↔ 0.9x online)', () => {
    const mir = new Mirror(PORTO_ARDESIA, 0);
    mir.applyState(snap([player(0), player(1)]));
    const seen: number[] = [];
    for (let i = 0; i < 300; i++) { mir.tickLocal(1 / 90, true, false); seen.push(mir.match.combatants[0]!.weapon.ads); }
    expect(seen.slice(40).every((a) => a === 1)).toBe(true);
    for (let i = 0; i < 300; i++) mir.tickLocal(1 / 90, false, false);
    expect(mir.match.combatants[0]!.weapon.ads).toBe(0);
  });
});

describe('mirror: events from a newer server', () => {
  it('unknown snapshot events are dropped, never passed on as undefined; resupply maps through', () => {
    const mir = new Mirror(PORTO_ARDESIA, 0);
    const evs = mir.applyState(snap([player(0), player(1)], [{ e: 'futureThing' } as never, { e: 'resupply', by: 1, vic: 0, n: 30 }]));
    expect(evs.every((e) => e && typeof e.type === 'string')).toBe(true);
    expect(evs.filter((e) => e.type === 'resupply')).toEqual([{ type: 'resupply', giver: 1, recipient: 0, rounds: 30 }]);
  });
});
