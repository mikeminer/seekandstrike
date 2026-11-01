import { describe, expect, it } from 'vitest';
import { MAX_CMDS_PER_MESSAGE, parseClientMessage, type InputMessage } from '@shared/protocol';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { PlayerClass } from '@shared/sim/etClasses';
import type { MoveCmd } from '@shared/sim/playerMove';
import { RoomSim, SIM_STEP } from './roomSim';
import { MONITOR } from './monitor';
import { MAX_REWIND_SECONDS } from '@shared/sim/match';

function make(extra: Partial<ConstructorParameters<typeof RoomSim>[0]> = {}) {
  let t = 1_000_000;
  let n = 0;
  const room = new RoomSim({ map: PORTO_ARDESIA, seed: 5, now: () => t, token: () => `tok${++n}`, graceMs: 20_000, restartAfterMs: 8000, ...extra });
  return { room, clock: { advance: (ms: number) => { t += ms; }, get now() { return t; } } };
}
type Harness = ReturnType<typeof make>;
const cmd = (o: Partial<MoveCmd> = {}): MoveCmd => ({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0, ...o });
const msg = (seq: number, cmds: MoveCmd[]): InputMessage => ({ t: 'input', seq, cmds });

/** Per-seat command feeder: queues `n` commands of the same input per call, numbering them consecutively. */
function feeder(h: Harness, seat: number) {
  let seq = 0;
  return {
    send(n: number, o: Partial<MoveCmd> = {}, extra: (i: number) => Partial<MoveCmd> = () => ({})): void {
      const cmds = Array.from({ length: n }, (_, i) => cmd({ ...o, ...extra(i) }));
      h.room.input(seat, msg(seq, cmds));
      seq += n;
    },
    get next(): number { return seq; },
  };
}
/** Run `seconds` of wall-clock time in 50 ms ticks, feeding 3 commands (one per 60 Hz step) per tick when `o` is given. */
function run(h: Harness, seconds: number, f?: ReturnType<typeof feeder>, o: Partial<MoveCmd> = {}): void {
  for (let t = 0; t < seconds; t += 0.05) {
    f?.send(3, o);
    h.clock.advance(50);
    h.room.advance(50);
  }
}
function join(h: Harness, cls: PlayerClass = PlayerClass.Soldier, name = 'A') {
  const r = h.room.join(name, cls);
  if (!r.ok) throw new Error('join failed');
  return r.seat;
}

describe('protocol input validation', () => {
  const one = JSON.stringify(msg(3, [cmd({ moveY: 1, yaw: 1.2 })]));
  it('accepts a batch and ignores fields a client should not control', () => {
    const raw = JSON.parse(one);
    raw.cmds[0].hp = 100000; raw.cmds[0].x = 5; raw.hp = 1;
    const m = parseClientMessage(JSON.stringify(raw));
    expect(m).toMatchObject({ t: 'input', seq: 3, cmds: [{ moveY: 1, yaw: 1.2 }] });
    expect(JSON.stringify(m)).not.toContain('hp');
    expect(JSON.stringify(m)).not.toContain('"x"');
  });
  it('rejects out-of-range, non-finite, wrong-type, empty, oversized and over-long batches', () => {
    const withCmd = (patch: object) => JSON.stringify({ t: 'input', seq: 1, cmds: [{ ...JSON.parse(one).cmds[0], ...patch }] });
    for (const bad of [{ moveX: 2 }, { moveY: -1.5 }, { yaw: 'a' }, { pitch: 3 }, { stance: 3 }, { fire: 'yes' }]) expect(parseClientMessage(withCmd(bad))).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":-1,"cmds":[]}')).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":1,"cmds":[]}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 1, cmds: Array.from({ length: MAX_CMDS_PER_MESSAGE + 1 }, () => cmd()) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 1, cmds: [cmd({ moveX: 1e999 })] }))).toBeNull();
    expect(parseClientMessage(one + ' '.repeat(5000))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 1.5, cmds: [cmd()] }))).toBeNull();
  });
  it('sanitises names and class in hello', () => {
    expect(parseClientMessage('{"t":"hello","v":2,"name":"<b>Rex</b> Ünï","cls":2}')).toEqual({ t: 'hello', v: 2, name: 'bRexb Ünï', cls: 2 });
    expect(parseClientMessage('{"t":"hello","v":2,"cls":9}')).toEqual({ t: 'hello', v: 2 });
  });
});

describe('seating', () => {
  it('balances teams, fills 8 seats and rejects the ninth', () => {
    const { room } = make();
    const teams = Array.from({ length: 8 }, (_, i) => { const r = room.join(`P${i}`, PlayerClass.Soldier); expect(r.ok).toBe(true); return r.ok ? r.team : -1; });
    expect(teams.filter((t) => t === 0)).toHaveLength(4);
    expect(teams.filter((t) => t === 1)).toHaveLength(4);
    expect(room.join('Late', PlayerClass.Soldier)).toEqual({ ok: false, error: 'room_full' });
    expect(room.humans).toBe(8);
  });
  it('a human takes over a slot with their class and name; leaving gives it back to a bot', () => {
    const { room } = make();
    const r = room.join('Rex', PlayerClass.Engineer);
    if (!r.ok) throw new Error('join failed');
    const c = room.match.combatants[r.seat.id]!;
    expect(c.isBot).toBe(false);
    expect(c.callsign).toBe('Rex');
    expect(c.cls).toBe(PlayerClass.Engineer);
    expect(c.grenades).toBe(2);
    expect(room.match.brains.has(c.id)).toBe(false);
    room.leave(r.seat.id);
    expect(c.isBot).toBe(true);
    expect(room.match.brains.has(c.id)).toBe(true);
    expect(room.humans).toBe(0);
  });
});

describe('command queue (one command per 60 Hz step, in order)', () => {
  it('moves the player from queued commands and acknowledges the last consumed number', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    const c = h.room.match.combatants[seat.id]!;
    const z0 = c.pos.z;
    run(h, 1.5, f, { moveY: 1 });
    expect(Math.abs(c.pos.z - z0)).toBeGreaterThan(2);
    expect(seat.ack).toBeGreaterThan(60);
    expect(seat.ack).toBeLessThan(f.next);
  });
  it('consumes exactly one command per sim step', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    f.send(6, { moveY: 1 });
    h.room.advance(3 * 1000 * SIM_STEP + 1); // three steps' worth of time
    expect(seat.ack).toBe(2); // commands 0, 1, 2 consumed
    expect(seat.queue).toHaveLength(3);
  });
  it('ignores replayed or older command numbers', () => {
    const h = make();
    const seat = join(h);
    h.room.input(seat.id, msg(10, [cmd(), cmd(), cmd()]));
    // 8..11 are all older than what is already queued (up to 12): nothing is added.
    h.room.input(seat.id, msg(8, [cmd({ moveY: 1 }), cmd({ moveY: 1 }), cmd({ moveY: 1 }), cmd({ moveY: 1 })]));
    expect(seat.queue.map((q) => q.seq)).toEqual([10, 11, 12]);
    expect(seat.lastQueued).toBe(12);
  });
  it('repeats the last movement (never fire or presses) when the queue runs dry, and counts it', () => {
    const h = make();
    const seat = join(h);
    const c = h.room.match.combatants[seat.id]!;
    h.room.input(seat.id, msg(0, [cmd({ moveY: 1, fire: true, grenade: true })]));
    h.clock.advance(100);
    h.room.advance(100); // 6 steps: one real command, five repeats
    expect(seat.starved).toBe(5);
    expect(seat.ack).toBe(0);
    expect(c.input.fire).toBe(false);
    expect(c.input.throwGrenade).toBe(false);
    expect(c.input.moveY).toBe(1);
    expect(c.grenades).toBe(2); // the one real command threw exactly one
  });
  it('folds old commands in when far behind, keeping their presses', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    f.send(30, {}, (i) => (i === 3 ? { grenade: true } : {}));
    h.room.advance(1000 * SIM_STEP + 1); // one step
    expect(seat.queue.length).toBeLessThanOrEqual(8);
    expect(h.room.match.combatants[seat.id]!.grenades).toBe(2); // the press in a folded command still counted
  });
  it('a grenade press is a single throw', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    f.send(3, {}, (i) => (i === 0 ? { grenade: true } : {}));
    run(h, 1, f);
    expect(h.room.match.combatants[seat.id]!.grenades).toBe(2);
    expect(h.room.match.grenades.length).toBeGreaterThanOrEqual(1);
  });
  it('limits how fast the view can turn (no instant 180 degree snaps)', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    const c = h.room.match.combatants[seat.id]!;
    const y0 = c.yaw;
    f.send(1, { yaw: y0 + Math.PI });
    h.room.advance(1000 * SIM_STEP + 1);
    expect(Math.abs(c.yaw - y0)).toBeLessThanOrEqual(14 * SIM_STEP + 1e-9);
    run(h, 1, f, { yaw: y0 + Math.PI });
    expect(Math.abs(c.yaw - (y0 + Math.PI))).toBeLessThan(0.01);
  });
  it('disconnected seats idle and cannot fire', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    const c = h.room.match.combatants[seat.id]!;
    run(h, 0.3, f, { fire: true, moveY: 1 });
    const rounds = c.weapon.inMag;
    h.room.disconnect(seat.id);
    run(h, 1);
    expect(c.weapon.inMag).toBe(rounds);
    expect(c.input.fire).toBe(false);
    h.room.input(seat.id, msg(500, [cmd({ fire: true })])); // ignored while disconnected
    expect(seat.queue).toHaveLength(0);
  });
});

describe('reconnect grace', () => {
  it('resumes the same seat within 20 s and releases it to a bot after', () => {
    const h = make();
    const seat = join(h, PlayerClass.Medic);
    h.room.disconnect(seat.id);
    run(h, 10);
    const back = h.room.join('whoever', PlayerClass.Soldier, seat.token);
    expect(back).toMatchObject({ ok: true, resumed: true });
    if (!back.ok) throw new Error();
    expect(back.seat.id).toBe(seat.id);
    expect(back.seat.cls).toBe(PlayerClass.Medic);
    h.room.disconnect(seat.id);
    run(h, 21);
    expect(h.room.seats.has(seat.id)).toBe(false);
    expect(h.room.match.combatants[seat.id]!.isBot).toBe(true);
    expect(h.room.join('A', PlayerClass.Soldier, seat.token)).toMatchObject({ ok: true, resumed: false });
  });
});

describe('snapshots', () => {
  it('only seated, connected players get one; it carries all 8 players, the ack, own ammo and exact movement state', () => {
    const h = make();
    const a = join(h, PlayerClass.Soldier, 'A'), b = join(h, PlayerClass.Medic, 'B');
    const f = feeder(h, a.id);
    run(h, 0.5, f, { moveY: 1 });
    h.room.disconnect(b.id);
    const snaps = h.room.snapshots();
    expect([...snaps.keys()]).toEqual([a.id]);
    const s = snaps.get(a.id)!;
    expect(s.players).toHaveLength(8);
    expect(s.ack).toBe(a.ack);
    expect(s.you).toBe(a.id);
    expect(s.self).toMatchObject({ hp: 100, grenades: 3, reloading: false });
    const c = h.room.match.combatants[a.id]!;
    expect(s.self.mv.z).toBeCloseTo(c.pos.z, 3);
    expect(s.self.mv.vz).toBeCloseTo(c.move.vel.z, 3);
    expect(s.self.mv.g).toBe(c.move.grounded ? 1 : 0);
    expect(s.players.filter((p) => p.hu === 1)).toHaveLength(2);
    expect(JSON.stringify(s).length).toBeLessThan(4500);
  });
  it('events are delivered once', () => {
    const h = make();
    const a = join(h);
    const f = feeder(h, a.id);
    run(h, 0.3, f, { fire: true });
    expect(h.room.snapshots().get(a.id)!.ev.some((e) => e.e === 'shot')).toBe(true);
    expect(h.room.snapshots().get(a.id)!.ev.filter((e) => e.e === 'shot' && e.by === a.id)).toHaveLength(0);
  });
});

describe('rounds', () => {
  it('a finished round restarts after the delay and keeps the seats and classes; the queue starts clean', () => {
    const h = make();
    const a = join(h, PlayerClass.Engineer);
    const f = feeder(h, a.id);
    f.send(5, { moveY: 1 });
    h.room.match.objective.phase = 'attackersWin';
    expect(h.room.advance(50)).toBe(false);
    expect(h.room.roundWinner).toBe(0);
    h.clock.advance(8100);
    expect(h.room.advance(50)).toBe(true);
    expect(h.room.match.phase).toBe('playing');
    const c = h.room.match.combatants[a.id]!;
    expect(c.isBot).toBe(false);
    expect(c.cls).toBe(PlayerClass.Engineer);
    expect(c.callsign).toBe('A');
    expect(a.queue).toHaveLength(0);
    expect(a.ack).toBe(-1);
    expect(h.room.roundEndsAt).toBe(0);
  });
});

describe('load', () => {
  it('8 humans plus bots run a minute of match time well within the Worker CPU budget', () => {
    const h = make();
    const seats = Array.from({ length: 8 }, (_, i) => join(h, PlayerClass.Soldier, `P${i}`));
    const fs = seats.map((s) => feeder(h, s.id));
    const t0 = performance.now();
    for (let tick = 0; tick < 20 * 60; tick++) {
      fs.forEach((f) => f.send(3, { moveY: 1, fire: tick % 40 < 10, yaw: Math.sin(tick / 30) }));
      h.clock.advance(50);
      h.room.advance(50);
      if (tick % 4 !== 0) h.room.snapshots();
    }
    const msPerTick = (performance.now() - t0) / (20 * 60);
    console.log(`room tick cost: ${msPerTick.toFixed(2)} ms`);
    expect(msPerTick).toBeLessThan(25);
    for (const c of h.room.match.combatants) { expect(Number.isFinite(c.pos.x)).toBe(true); expect(Number.isFinite(c.pos.z)).toBe(true); }
  });
});

describe('lag compensation inputs', () => {
  it('turns the view time of a command into a clamped rewind', () => {
    const h = make();
    const seat = join(h);
    const c = h.room.match.combatants[seat.id]!;
    run(h, 1); // some match time
    const t = h.room.match.time;
    const send = (vt: number | undefined) => {
      h.room.input(seat.id, msg(seat.lastQueued + 1, [cmd({ ...(vt === undefined ? {} : { vt }) })]));
      h.clock.advance(20);
      h.room.advance(20);
    };
    send(t - 0.2);
    expect(c.lag).toBeCloseTo(0.2 + 0.0167, 1); // measured one step later than the stamp, so a little more
    send(t - 5); // far too old: capped at the rewind limit
    expect(c.lag).toBeCloseTo(MAX_REWIND_SECONDS, 6);
    expect(seat.monitor.stats.viewTimeClamped).toBeGreaterThan(0);
    send(t + 10); // from the future: no rewind
    expect(c.lag).toBe(0);
    send(undefined);
    expect(c.lag).toBe(0);
  });
  it('the shooter\'s rewind only affects hit tests, never movement or the target\'s own state', () => {
    const h = make();
    const a = join(h, PlayerClass.Soldier, 'A'), b = join(h, PlayerClass.Soldier, 'B');
    run(h, 0.5);
    const fa = feeder(h, a.id), fb = feeder(h, b.id);
    const before = JSON.stringify(h.room.match.combatants[b.id]!.pos);
    fa.send(3, { vt: Math.max(0, h.room.match.time - 0.2) });
    run(h, 0.2, fb);
    expect(JSON.stringify(h.room.match.combatants[b.id]!.pos)).toBe(before); // b did not move because a had lag
  });
});

describe('server-side checks', () => {
  it('a command flood is dropped, then kicked: the seat is freed and goes back to a bot', () => {
    const h = make();
    const seat = join(h);
    let seq = 0;
    let kicked: number[] = [];
    for (let i = 0; i < 400 && kicked.length === 0; i++) {
      h.room.input(seat.id, msg(seq, Array.from({ length: 10 }, () => cmd())));
      seq += 10;
      h.clock.advance(66);
      h.room.advance(66);
      kicked = h.room.drainKicks();
    }
    expect(kicked).toEqual([seat.id]);
    expect(h.room.seats.has(seat.id)).toBe(false);
    expect(h.room.match.combatants[seat.id]!.isBot).toBe(true);
    expect(h.room.drainKicks()).toEqual([]); // reported once
  });
  it('normal play produces no speed violations (turning while sprinting gains up to ~22% in this Quake-style sim)', () => {
    const h = make();
    const seats = Array.from({ length: 4 }, (_, i) => join(h, PlayerClass.Soldier, `P${i}`));
    const fs = seats.map((s) => feeder(h, s.id));
    for (let tick = 0; tick < 20 * 20; tick++) {
      fs.forEach((f) => f.send(3, { moveY: 1, sprint: true, yaw: Math.sin(tick / 20) }));
      h.clock.advance(50);
      h.room.advance(50);
    }
    for (const r of h.room.report()) {
      expect(r.stats.speedViolations).toBe(0);
      expect(r.stats.maxSpeed).toBeLessThan(MONITOR.maxSpeed); // the physical limit used by the check
      expect(r.stats.dropped).toBe(0);
    }
    expect(Math.max(...h.room.report().map((r) => r.stats.maxSpeed))).toBeGreaterThan(5);
  });
  it('counts shots of human shooters', () => {
    const h = make();
    const seat = join(h);
    const f = feeder(h, seat.id);
    run(h, 1, f, { fire: true });
    expect(seat.monitor.stats.shots).toBeGreaterThan(5);
  });
});
