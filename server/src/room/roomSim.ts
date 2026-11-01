/**
 * Authoritative room simulation (pure TypeScript, no Cloudflare APIs, so it is unit-testable).
 *
 * The room runs the shared offline simulation with every seat on the field: slots not held by a
 * human are bots. Joining a human converts a slot (keeping team balance); leaving for longer than the
 * reconnect grace converts it back. Clients send only inputs and view angles; this code applies them,
 * steps the shared sim at 60 Hz and builds snapshots. Nothing the client sends can set positions,
 * health, ammo, hits or the objective.
 *
 * Known limits (see docs/online.md): collision is the plain AABB host (no client prediction yet),
 * view angles are trusted within range (no turn-rate limit), hits are resolved at server time (no lag compensation).
 */
import { Match, AabbHost, MAX_REWIND_SECONDS, type SimEvent } from '@shared/sim/match';
import { SeatMonitor } from './monitor';
import type { Combatant, Team } from '@shared/sim/combatant';
import type { PlayerClass } from '@shared/sim/etClasses';
import type { MapDef } from '@shared/map/types';
import type { InputMessage, SnapEvent, SnapPlayer, Snapshot } from '@shared/protocol';
import { applyCmdToInput, type MoveCmd } from '@shared/sim/playerMove';
import { RECONNECT_GRACE_MS } from '@shared/constants';

export const SIM_STEP = 1 / 60;
const MAX_STEPS_PER_ADVANCE = 6;
const MAX_EVENTS_PER_SNAPSHOT = 96;

/** Commands queued per seat. Above MAX_QUEUE the oldest are dropped; above SKIP_ABOVE the oldest are folded into the next step. */
const MAX_QUEUE = 40;
const SKIP_ABOVE = 8;

interface Queued { seq: number; cmd: MoveCmd }

export interface Seat {
  /** Combatant id (slot) this seat controls. */
  id: number;
  token: string;
  name: string;
  cls: PlayerClass;
  connected: boolean;
  graceUntil: number;
  /** Last command number consumed by the simulation (echoed to the client). */
  ack: number;
  /** Highest command number queued so far (duplicates and replays are ignored). */
  lastQueued: number;
  queue: Queued[];
  /** Last consumed command, repeated (movement only) while the queue is empty. */
  lastCmd: MoveCmd;
  /** Steps run without a fresh command (a lag spike or clock drift); for diagnostics. */
  starved: number;
  monitor: SeatMonitor;
  /** Position and life state after the previous step (for the speed check). */
  prev: { x: number; z: number; alive: boolean } | null;
}

export interface RoomOptions {
  map: MapDef;
  seed: number;
  attackers?: number;
  defenders?: number;
  restartAfterMs?: number;
  graceMs?: number;
  /** Rewind hit tests to the shooter's view (default true). Switchable for comparisons in tests. */
  lagCompensation?: boolean;
  now: () => number;
  token: () => string;
}

export type JoinResult =
  | { ok: true; seat: Seat; team: Team; resumed: boolean }
  | { ok: false; error: 'room_full' };

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export class RoomSim {
  match: Match;
  seats = new Map<number, Seat>();
  private byToken = new Map<string, Seat>();
  tick = 0;
  /** Set when the current round ended: wall-clock time the next one starts. */
  roundEndsAt = 0;
  roundWinner: Team | null = null;
  private kickList: number[] = [];
  private acc = 0;
  private events: SnapEvent[] = [];
  private roundSeed: number;
  private readonly attackers: number;
  private readonly defenders: number;

  constructor(private readonly opts: RoomOptions) {
    this.attackers = opts.attackers ?? 4;
    this.defenders = opts.defenders ?? 4;
    this.roundSeed = opts.seed;
    this.match = this.newMatch();
  }

  get capacity(): number { return this.attackers + this.defenders; }
  get humans(): number { return this.seats.size; }
  get connectedCount(): number { let n = 0; for (const s of this.seats.values()) if (s.connected) n++; return n; }

  private newMatch(): Match {
    return new Match(this.opts.map, {
      seed: this.roundSeed, attackers: this.attackers, defenders: this.defenders, withPlayer: false, lagCompensation: this.opts.lagCompensation ?? true,
    }, new AabbHost(this.opts.map));
  }

  private slots(team: Team): number[] {
    const first = team === 0 ? 0 : this.attackers;
    const n = team === 0 ? this.attackers : this.defenders;
    return Array.from({ length: n }, (_, i) => first + i);
  }

  private neutral(yaw: number, pitch: number): MoveCmd {
    return { moveX: 0, moveY: 0, yaw, pitch, sprint: false, aim: false, fire: false, interact: false, stance: 0 };
  }

  /** True when `token` can take back a seat that is waiting out its grace period. */
  canResume(token: string): boolean {
    const seat = this.byToken.get(token);
    return !!seat && !seat.connected && this.opts.now() <= seat.graceUntil;
  }

  /** Adds a human (or resumes a seat within the grace window). */
  join(name: string, cls: PlayerClass, resumeToken?: string): JoinResult {
    if (resumeToken) {
      const seat = this.byToken.get(resumeToken);
      if (seat && !seat.connected && this.opts.now() <= seat.graceUntil) {
        seat.connected = true;
        return { ok: true, seat, team: this.match.combatants[seat.id]!.team, resumed: true };
      }
    }
    // Team with fewer humans, then the first slot not held by a human.
    const count = (t: Team): number => this.slots(t).filter((id) => this.seats.has(id)).length;
    const team: Team = count(0) <= count(1) ? 0 : 1;
    const order: Team[] = team === 0 ? [0, 1] : [1, 0];
    for (const t of order) {
      const id = this.slots(t).find((i) => !this.seats.has(i));
      if (id === undefined) continue;
      const c = this.match.combatants[id]!;
      const seat: Seat = {
        id, token: this.opts.token(), name: name || `Player${id}`, cls, connected: true, graceUntil: 0, ack: -1,
        lastQueued: -1, queue: [], lastCmd: this.neutral(c.yaw, c.pitch), starved: 0,
        monitor: new SeatMonitor(this.opts.now()), prev: null,
      };
      this.seats.set(id, seat);
      this.byToken.set(seat.token, seat);
      this.match.assignHuman(id, seat.name, cls);
      return { ok: true, seat, team: c.team, resumed: false };
    }
    return { ok: false, error: 'room_full' };
  }

  /** The socket closed: the seat idles for the grace period, then goes back to a bot. */
  disconnect(seatId: number): void {
    const seat = this.seats.get(seatId);
    if (!seat || !seat.connected) return;
    seat.connected = false;
    seat.graceUntil = this.opts.now() + (this.opts.graceMs ?? RECONNECT_GRACE_MS);
  }

  /** Immediate removal (explicit leave). */
  leave(seatId: number): void {
    const seat = this.seats.get(seatId);
    if (!seat) return;
    this.seats.delete(seatId);
    this.byToken.delete(seat.token);
    this.match.releaseToBot(seatId);
  }

  /** Queues a batch of commands (numbered from m.seq). Already-seen numbers are ignored. */
  input(seatId: number, m: InputMessage): void {
    const seat = this.seats.get(seatId);
    if (!seat || !seat.connected) return;
    const accepted = seat.monitor.admit(this.opts.now(), m.cmds.length);
    if (seat.monitor.kicked && !this.kickList.includes(seatId)) this.kickList.push(seatId);
    m.cmds.slice(0, accepted).forEach((cmd, i) => {
      const seq = m.seq + i;
      if (seq <= seat.lastQueued) return;
      seat.lastQueued = seq;
      seat.queue.push({ seq, cmd });
    });
    while (seat.queue.length > MAX_QUEUE) seat.queue.shift();
  }

  /**
   * Lag compensation: how far behind the server the shooter's view was, from the view time in the command.
   * Never more than MAX_REWIND_SECONDS; a view time from the future (or absent) means no rewind.
   */
  private setLag(seat: Seat, c: Combatant, vt: number | undefined): void {
    if (vt === undefined || this.opts.lagCompensation === false) { c.lag = 0; return; }
    const lag = this.match.time - vt;
    if (lag < -0.05 || lag > MAX_REWIND_SECONDS * 4) seat.monitor.viewTimeClamped();
    c.lag = Math.max(0, Math.min(MAX_REWIND_SECONDS, lag));
  }

  /** Feeds each human one command per 60 Hz step, in order. */
  private applyInputs(): void {
    for (const seat of this.seats.values()) {
      const c = this.match.combatants[seat.id]!;
      if (!seat.connected) {
        // Idle while disconnected: no movement, no shooting.
        applyCmdToInput(c, this.neutral(c.yaw, c.pitch));
        continue;
      }
      // Too far behind (clock drift, burst after a stall): fold the oldest commands in, keeping their presses.
      const carry: Pick<MoveCmd, 'jump' | 'reload' | 'tapOut' | 'grenade'> = {};
      while (seat.queue.length > SKIP_ABOVE) {
        const d = seat.queue.shift()!;
        if (d.cmd.jump) carry.jump = true;
        if (d.cmd.reload) carry.reload = true;
        if (d.cmd.tapOut) carry.tapOut = true;
        if (d.cmd.grenade) carry.grenade = true;
      }
      const next = seat.queue.shift();
      let cmd: MoveCmd;
      if (next) {
        cmd = { ...next.cmd };
        if (carry.jump) cmd.jump = true;
        if (carry.reload) cmd.reload = true;
        if (carry.tapOut) cmd.tapOut = true;
        if (carry.grenade) cmd.grenade = true;
        seat.ack = next.seq;
        seat.lastCmd = next.cmd;
        this.setLag(seat, c, next.cmd.vt);
      } else {
        // No command arrived in time: keep moving the way the player was, but never fire or press anything.
        cmd = { ...seat.lastCmd, fire: false, interact: false };
        delete cmd.jump; delete cmd.reload; delete cmd.tapOut; delete cmd.grenade;
        seat.starved++;
      }
      applyCmdToInput(c, cmd);
    }
  }

  /** Advances the simulation by `dtMs` of wall-clock time. Returns true when a new round just started. */
  advance(dtMs: number): boolean {
    const now = this.opts.now();
    // Release seats whose grace ran out.
    for (const seat of [...this.seats.values()]) if (!seat.connected && now > seat.graceUntil) this.leave(seat.id);

    let newRound = false;
    if (this.match.phase !== 'playing') {
      if (this.roundEndsAt === 0) {
        this.roundEndsAt = now + (this.opts.restartAfterMs ?? 8000);
        this.roundWinner = this.match.phase === 'attackersWin' ? 0 : 1;
      } else if (now >= this.roundEndsAt) {
        this.startRound();
        newRound = true;
      }
      return newRound;
    }

    this.acc = Math.min(this.acc + dtMs / 1000, SIM_STEP * MAX_STEPS_PER_ADVANCE);
    while (this.acc >= SIM_STEP) {
      this.applyInputs();
      this.match.step(SIM_STEP);
      this.checkSpeeds();
      for (const e of this.match.drainEvents()) this.pushEvent(e);
      this.acc -= SIM_STEP;
      if (this.match.phase !== 'playing') break;
    }
    this.tick++;
    return false;
  }

  /** Compares the horizontal speed each human actually had in the step with the physical maximum (diagnostic only). */
  private checkSpeeds(): void {
    for (const seat of this.seats.values()) {
      const c = this.match.combatants[seat.id]!;
      const alive = c.health.state === 'alive';
      if (seat.prev && seat.prev.alive && alive) seat.monitor.checkSpeed(Math.hypot(c.pos.x - seat.prev.x, c.pos.z - seat.prev.z) / SIM_STEP);
      seat.prev = { x: c.pos.x, z: c.pos.z, alive };
    }
  }

  /** Seats that must be disconnected for a hard violation (command flood); each is returned once and removed. */
  drainKicks(): number[] {
    const k = this.kickList;
    this.kickList = [];
    for (const id of k) this.leave(id);
    return k;
  }

  /** Diagnostics per human seat. */
  report(): { seat: number; name: string; stats: SeatMonitor['stats'] }[] {
    return [...this.seats.values()].map((s) => ({ seat: s.id, name: s.name, stats: { ...s.monitor.stats } }));
  }

  private startRound(): void {
    this.roundSeed = (this.roundSeed * 1103515245 + 12345) >>> 0;
    this.match = this.newMatch();
    for (const seat of this.seats.values()) {
      this.match.assignHuman(seat.id, seat.name, seat.cls);
      const c = this.match.combatants[seat.id]!;
      seat.lastCmd = this.neutral(c.yaw, c.pitch); seat.queue = []; seat.lastQueued = -1; seat.ack = -1; seat.prev = null;
    }
    this.roundEndsAt = 0;
    this.roundWinner = null;
    this.acc = 0;
  }

  private pushEvent(e: SimEvent): void {
    this.recordForMonitor(e);
    if (this.events.length >= MAX_EVENTS_PER_SNAPSHOT) return;
    switch (e.type) {
      case 'shot': this.events.push({ e: 'shot', by: e.shooter, x: r2(e.origin.x), y: r2(e.origin.y), z: r2(e.origin.z), dx: r3(e.dir.x), dy: r3(e.dir.y), dz: r3(e.dir.z) }); break;
      case 'impact': this.events.push({ e: 'impact', x: r2(e.point.x), y: r2(e.point.y), z: r2(e.point.z), mat: e.material, ...(e.targetId !== undefined ? { tgt: e.targetId } : {}) }); break;
      case 'damage': this.events.push({ e: 'damage', by: e.attacker, vic: e.victim, amt: r2(e.amount), zone: e.zone, out: e.outcome }); break;
      case 'grenade': this.events.push({ e: 'grenade', by: e.thrower, x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z) }); break;
      case 'explosion': this.events.push({ e: 'explosion', by: e.thrower, x: r2(e.pos.x), y: r2(e.pos.y), z: r2(e.pos.z) }); break;
      case 'revive': this.events.push({ e: 'revive', by: e.medic, vic: e.patient }); break;
      case 'objective': this.events.push({ e: 'objective', ev: e.event }); break;
      case 'wave': this.events.push({ e: 'wave', tm: e.team }); break;
      case 'matchEnd': this.events.push({ e: 'matchEnd', winner: e.winner }); break;
      default: break;
    }
  }

  /** Shots and hits of human shooters feed the aim statistics (grenade blasts and friendly fire do not count). */
  private recordForMonitor(e: SimEvent): void {
    if (e.type === 'shot') this.seats.get(e.shooter)?.monitor.shot();
    else if (e.type === 'damage' && e.attacker !== e.victim && e.zone !== 'blast') this.seats.get(e.attacker)?.monitor.hit(e.zone === 'head');
  }

  private players(): SnapPlayer[] {
    return this.match.combatants.map((c: Combatant): SnapPlayer => ({
      id: c.id, tm: c.team, cl: c.cls, n: c.callsign,
      x: r2(c.pos.x), y: r2(c.pos.y), z: r2(c.pos.z), yw: r3(c.yaw), pt: r3(c.pitch),
      st: c.move.stance === 'stand' ? 0 : c.move.stance === 'crouch' ? 1 : 2,
      lf: c.health.state === 'alive' ? 0 : c.health.state === 'downed' ? 1 : 2,
      hp: Math.round(c.health.hp), sp: r2(c.speed), hu: this.seats.has(c.id) ? 1 : 0, k: c.kills, d: c.deaths,
      ...(c.weapon.phase === 'reloading' ? { rl: 1 as const } : {}),
      ...(c.input.aim ? { ad: 1 as const } : {}),
    }));
  }

  /** One snapshot per connected human; clears the shared event buffer. */
  snapshots(): Map<number, Snapshot> {
    const out = new Map<number, Snapshot>();
    const players = this.players();
    const o = this.match.objective;
    const grenades = this.match.grenades.map((g) => ({ id: g.id, x: r2(g.pos.x), y: r2(g.pos.y), z: r2(g.pos.z) }));
    const obj = { charge: o.charge, progress: r2(o.progress), fuse: r2(o.fuse), clock: r2(o.clock), phase: o.phase };
    const ev = this.events;
    for (const seat of this.seats.values()) {
      if (!seat.connected) continue;
      const c = this.match.combatants[seat.id]!;
      out.set(seat.id, {
        t: 'snap', tick: this.tick, time: r2(this.match.time), ack: seat.ack, you: seat.id,
        self: {
          hp: Math.round(c.health.hp), mag: c.weapon.inMag + (c.weapon.chambered ? 1 : 0), reserve: c.weapon.reserve,
          grenades: c.grenades, stamina: r2(c.move.stamina), reloading: c.weapon.phase === 'reloading',
          mv: {
            x: r3(c.pos.x), y: r3(c.pos.y), z: r3(c.pos.z), vx: r3(c.move.vel.x), vy: r3(c.move.vel.y), vz: r3(c.move.vel.z),
            yw: r3(c.yaw), pt: r3(c.pitch), st: c.move.stance === 'stand' ? 0 : c.move.stance === 'crouch' ? 1 : 2,
            stt: r3(c.move.stanceTimer), g: c.move.grounded ? 1 : 0, sp: c.move.sprinting ? 1 : 0,
          },
        },
        players, grenades, obj, ev,
      });
    }
    this.events = [];
    return out;
  }
}
