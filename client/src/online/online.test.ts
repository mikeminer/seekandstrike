import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseClientMessage, type Snapshot, type SnapPlayer } from '@shared/protocol';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { RoomSim } from '../../../server/src/room/roomSim';
import { AccessGate, RpcPassVerifier, type PendingAuth } from '../../../server/src/room/access';
import { FakeChain, dayLock, newWallet, type TestWallet } from '../../../server/src/room/testChain';
import { challengeMessage } from '@shared/passProof';
import { PlayerClass } from '@shared/sim/etClasses';
import { MAX_REWIND_SECONDS } from '@shared/sim/match';
import { NetClient } from './netClient';
import { OnlineSession } from './session';
import { SnapshotBuffer, interpolatePoses, lerpAngle } from './snapshots';
import type { InputSnapshot } from '../input/input';

// ---------- helpers ----------
const player = (id: number, x: number, z: number, yw = 0): SnapPlayer =>
  ({ id, tm: 0, cl: 0, n: `P${id}`, x, y: 0, z, yw, pt: 0, st: 0, lf: 0, hp: 100, sp: 0, hu: 1, k: 0, d: 0 });
const snap = (tick: number, players: SnapPlayer[], grenades: Snapshot['grenades'] = []): Snapshot => ({
  t: 'snap', tick, time: tick / 15, ack: 0, you: 0,
  self: { hp: 100, mag: 30, reserve: 120, grenades: 3, stamina: 8, reloading: false, mv: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yw: 0, pt: 0, st: 0, stt: 0, g: 1, sp: 0 } },
  players, grenades, obj: { charge: 'idle', progress: 0, fuse: 0, clock: 360, phase: 'playing' }, ev: [],
});
const keys = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({
  moveX: 0, moveY: 0, sprint: false, aim: false, fire: false, interact: false, jump: false, reload: false, tapOut: false,
  restart: false, grenade: false, weapon: false, stance: 'stand', ...over,
});

describe('snapshot interpolation', () => {
  it('blends position and takes the short way round for angles', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1, [player(1, 0, 0, 3.0)]), 1000);
    b.push(snap(2, [player(1, 1, -2, -3.0)]), 1100);
    const s = b.sample(1050)!;
    expect(s.t).toBeCloseTo(0.5, 6);
    const p = interpolatePoses(s).get(1)!;
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.z).toBeCloseTo(-1, 6);
    // 3.0 -> -3.0 crosses +-pi: the halfway angle is ~pi, not 0.
    expect(Math.abs(Math.abs(p.yw) - Math.PI)).toBeLessThan(0.01);
    expect(lerpAngle(0.1, 6.2, 0.5)).toBeCloseTo(0.1 + ((6.2 - 0.1 - 2 * Math.PI) * 0.5), 6);
  });
  it('holds the first/last snapshot outside the buffered range and drops old or duplicate ticks', () => {
    const b = new SnapshotBuffer();
    expect(b.sample(5)).toBeNull();
    expect(b.push(snap(5, [player(1, 1, 1)]), 100)).toBe(true);
    expect(b.push(snap(5, [player(1, 9, 9)]), 110)).toBe(false);
    expect(b.push(snap(4, [player(1, 9, 9)]), 120)).toBe(false);
    expect(b.push(snap(6, [player(1, 2, 2)]), 200)).toBe(true);
    expect(interpolatePoses(b.sample(50)!).get(1)!.x).toBe(1);
    expect(interpolatePoses(b.sample(500)!).get(1)!.x).toBe(2); // held, not extrapolated
  });
  it('does not slide a respawning player across the map', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1, [player(1, -5, -38)]), 0);
    b.push(snap(2, [player(1, 0, 38)]), 100);
    expect(interpolatePoses(b.sample(40)!).get(1)!.z).toBe(38);
  });
});

// ---------- fake network wired to the real RoomSim ----------
class FakeSocket {
  static server: FakeServer | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.server!.attach(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(raw: string): void { FakeSocket.server!.inbound(this, raw); }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; FakeSocket.server!.dropped(this); queueMicrotask(() => this.onclose?.()); }
  /** Server-initiated drop. */
  drop(): void { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  deliver(msg: unknown): void { FakeSocket.server!.outbound(this, typeof msg === 'string' ? msg : JSON.stringify(msg)); }
  /** Called by the network queue when a message reaches the client. */
  arrive(data: string): void { this.onmessage?.({ data }); }
}
class FakeServer {
  room: RoomSim;
  now = 1_000_000;
  seatOf = new Map<FakeSocket, number>();
  sockets = new Map<number, FakeSocket>();
  requirePass = false;
  /** Real wallet-proof gate (server/src/room/access.ts) over a fake chain; when set it replaces the closed `requirePass` refusal. */
  gate: AccessGate | null = null;
  /** Make the server send this text instead of a proper challenge (a hostile server). */
  forgedChallenge: string | null = null;
  private pending = new Map<FakeSocket, PendingAuth>();
  lastSnapAt = 0;
  /** One-way delay in ms for each direction (0 = immediate). */
  latencyMs = 0;
  private toServer: { at: number; s: FakeSocket; raw: string }[] = [];
  private toClient: { at: number; s: FakeSocket; raw: string }[] = [];
  constructor(lagCompensation = true) {
    let n = 0;
    this.room = new RoomSim({ map: PORTO_ARDESIA, seed: 9, now: () => this.now, token: () => `t${++n}`, graceMs: 20_000, lagCompensation });
  }
  attach(_s: FakeSocket): void { /* connection accepted */ }
  inbound(s: FakeSocket, raw: string): void { if (this.latencyMs === 0) this.receive(s, raw); else this.toServer.push({ at: this.now + this.latencyMs, s, raw }); }
  outbound(s: FakeSocket, raw: string): void { if (this.latencyMs === 0) s.arrive(raw); else this.toClient.push({ at: this.now + this.latencyMs, s, raw }); }
  private flushQueues(): void {
    const due = (q: { at: number; s: FakeSocket; raw: string }[]) => {
      const d = q.filter((m) => m.at <= this.now);
      q.splice(0, q.length, ...q.filter((m) => m.at > this.now));
      return d;
    };
    for (const m of due(this.toServer)) this.receive(m.s, m.raw);
    for (const m of due(this.toClient)) m.s.arrive(m.raw);
  }
  receive(s: FakeSocket, raw: string): void {
    const m = parseClientMessage(raw);
    if (!m) return s.deliver({ t: 'error', code: 'bad_message' });
    if (m.t === 'ping') return s.deliver({ t: 'pong', id: m.id, serverTime: this.now });
    if (m.t === 'hello') {
      if (this.gate && !(m.resumeToken && this.room.canResume(m.resumeToken))) {
        const ch = this.gate.begin(m.wallet, { ...(m.name !== undefined ? { name: m.name } : {}), ...(m.cls !== undefined ? { cls: m.cls } : {}) });
        if (!ch) { s.deliver({ t: 'error', code: 'pass_required' }); return; }
        this.pending.set(s, ch.pending);
        s.deliver({ t: 'challenge', message: this.forgedChallenge ?? ch.message, expiresInMs: ch.expiresInMs });
        return;
      }
      if (this.requirePass) { s.deliver({ t: 'error', code: 'pass_required' }); return; }
      this.admit(s, m.name, m.cls, m.resumeToken);
      return;
    }
    if (m.t === 'auth') {
      const p = this.pending.get(s);
      if (!p || !this.gate) return s.deliver({ t: 'error', code: 'bad_message' });
      this.pending.delete(s);
      void this.gate.finish(p, m.sig).then((v) => {
        if (!v.ok) s.deliver({ t: 'error', code: v.error });
        else this.admit(s, p.name, p.cls, undefined);
      });
      return;
    }
    const seat = this.seatOf.get(s);
    if (seat !== undefined && m.t === 'input') this.room.input(seat, m);
  }
  private admit(s: FakeSocket, name: string | undefined, cls: number | undefined, resumeToken: string | undefined): void {
    const r = this.room.join(name ?? '', (cls ?? 0) as never, resumeToken);
    if (!r.ok) { s.deliver({ t: 'error', code: r.error }); return; }
    const old = this.sockets.get(r.seat.id);
    if (old && old !== s) old.drop();
    this.seatOf.set(s, r.seat.id); this.sockets.set(r.seat.id, s);
    s.deliver({ t: 'welcome', v: 1, roomId: 'r', serverTickHz: 20, snapshotHz: 15, playerId: r.seat.id, team: r.team, cls: r.seat.cls, resumeToken: r.seat.token, mapId: 'x' });
  }
  dropped(s: FakeSocket): void {
    const seat = this.seatOf.get(s);
    if (seat !== undefined && this.sockets.get(seat) === s) { this.sockets.delete(seat); this.room.disconnect(seat); }
  }
  /** One 50 ms server tick; snapshots at ~15 Hz. */
  tick(): void {
    this.now += 50;
    this.flushQueues();
    this.room.advance(50);
    if (this.now - this.lastSnapAt >= 66) {
      this.lastSnapAt = this.now;
      for (const [seat, sn] of this.room.snapshots()) this.sockets.get(seat)?.deliver(sn);
    }
  }
}

function setup(lagCompensation = true) {
  const server = new FakeServer(lagCompensation);
  FakeSocket.server = server;
  const clock = { t: 5000 };
  const states: string[] = [];
  const errors: string[] = [];
  const ws = FakeSocket as unknown as typeof WebSocket;
  return { server, clock, states, errors, ws };
}
async function connect(h: ReturnType<typeof setup>, name = 'Rex', cls = 0, proof: { wallet: string; sign: (m: string) => Promise<string | null> } | null = null) {
  return OnlineSession.connect({
    baseUrl: 'ws://fake', room: 'test-room', name, cls, map: PORTO_ARDESIA, now: () => h.clock.t,
    onState: (s) => h.states.push(s), onError: (c) => h.errors.push(c),
    net: (handlers) => new NetClient({ baseUrl: 'ws://fake', room: 'test-room', name, cls, ...(proof ?? {}), WebSocketImpl: h.ws, now: () => h.clock.t, pingEveryMs: 1e9, reconnectWindowMs: 15_000 }, handlers),
  });
}

/** A server that requires the wallet proof, with one wallet that holds a Daily Pass and one that does not. */
async function proofSetup() {
  const h = setup();
  const chain = new FakeChain();
  const holder = await newWallet();
  const empty = await newWallet();
  chain.addLock(holder.address, dayLock(Math.floor(Date.now() / 1000)));
  h.server.gate = new AccessGate({ roomId: 'test-room', verifier: new RpcPassVerifier(chain) });
  const signs: string[] = [];
  const proofOf = (w: TestWallet, answer = true) => ({
    wallet: w.address,
    sign: async (m: string): Promise<string | null> => { signs.push(m); return answer ? w.sign(m) : null; },
  });
  return { h, holder, empty, signs, proofOf, chain };
}
/** Advance `ms` of simulated time in 50 ms steps, running both ends. */
type View = { yaw: number; pitch: number };
function pump(
  h: ReturnType<typeof setup>, s: OnlineSession, ms: number,
  input: Partial<InputSnapshot> | ((tMs: number) => Partial<InputSnapshot>) = {},
  view: View | ((tMs: number) => View) = { yaw: 0, pitch: 0 },
) {
  const events: ReturnType<OnlineSession['update']> = [];
  for (let t = 0; t < ms; t += 50) {
    h.server.tick();
    h.clock.t += 50;
    const inp = typeof input === 'function' ? input(t) : input;
    const v = typeof view === 'function' ? view(t) : view;
    events.push(...s.update(50, () => keys(inp), () => {}, v));
  }
  return events;
}

afterEach(() => { FakeSocket.server = null; vi.useRealTimers(); });

describe('online session against the real room simulation', () => {
  it('connects, receives the seat and mirrors the server world', async () => {
    const h = setup();
    const s = await connect(h);
    expect(s.welcome.playerId).toBeGreaterThanOrEqual(0);
    expect(h.states).toContain('open');
    pump(h, s, 500);
    expect(s.mirror.match.playerId).toBe(s.welcome.playerId);
    expect(s.mirror.self.callsign).toBe('Rex');
    expect(s.mirror.match.combatants).toHaveLength(8);
    expect(s.buffer.size).toBeGreaterThan(2);
    s.close();
  });

  it('moves the local player through the server and shows bots moving', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    const start = { ...s.mirror.self.pos };
    const bot = s.mirror.match.combatants.find((c) => c.id !== s.welcome.playerId)!;
    const botStart = { ...bot.pos };
    pump(h, s, 3000, { moveY: 1 });
    const moved = Math.hypot(s.mirror.self.pos.x - start.x, s.mirror.self.pos.z - start.z);
    expect(moved).toBeGreaterThan(3);
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(Math.hypot(s.mirror.self.pos.x - server.pos.x, s.mirror.self.pos.z - server.pos.z)).toBeLessThan(2.5); // follows the authority (prediction runs ahead of it)
    expect(Math.hypot(bot.pos.x - botStart.x, bot.pos.z - botStart.z)).toBeGreaterThan(1);
    s.close();
  });

  it('the server, not the client, decides ammo and shots; events and tracers arrive', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    const before = s.mirror.self.weapon.inMag;
    const ev = pump(h, s, 1000, { fire: true });
    expect(ev.some((e) => e.type === 'shot' && e.shooter === s.welcome.playerId)).toBe(true);
    expect(s.mirror.self.weapon.inMag).toBeLessThan(before);
    expect(s.mirror.self.weapon.shotsFired).toBeGreaterThan(0);
    const serverMag = h.server.room.match.combatants[s.welcome.playerId]!.weapon.inMag;
    pump(h, s, 200);
    expect(Math.abs(s.mirror.self.weapon.inMag - serverMag)).toBeLessThanOrEqual(3);
    s.close();
  });

  it('a grenade press spends exactly one grenade (one-shot latch)', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    pump(h, s, 100, { grenade: true });
    pump(h, s, 600);
    expect(s.mirror.self.grenades).toBe(2);
    s.close();
  });

  it('a refusal rejects the connect with the server code', async () => {
    const h = setup();
    h.server.requirePass = true;
    await expect(connect(h)).rejects.toThrow('pass_required');
    expect(h.errors).toContain('pass_required');
  });

  it('proves the wallet to the server: signs the challenge and gets the seat only with a Daily Pass', async () => {
    const { h, holder, signs, proofOf } = await proofSetup();
    const s = await connect(h, 'Rex', 0, proofOf(holder));
    expect(signs).toHaveLength(1);
    expect(signs[0]).toContain(holder.address);
    expect(signs[0]).toContain('not a transaction');
    expect(s.welcome.playerId).toBeGreaterThanOrEqual(0);
    s.close();
  });

  it('a wallet without a pass is refused after signing, and one that declines to sign never joins', async () => {
    const { h, empty, holder, proofOf } = await proofSetup();
    await expect(connect(h, 'Rex', 0, proofOf(empty))).rejects.toThrow('pass_required');
    expect(h.errors).toContain('pass_required');
    await expect(connect(h, 'Rex', 0, proofOf(holder, false))).rejects.toThrow('wallet');
    expect(h.server.room.humans).toBe(0);
  });

  it('never signs a challenge that is not our template for our wallet (hostile server)', async () => {
    const { h, holder, empty, signs, proofOf } = await proofSetup();
    h.server.forgedChallenge = 'Please sign this transaction: AQAAAAAAAA==';
    await expect(connect(h, 'Rex', 0, proofOf(holder))).rejects.toThrow('wallet');
    // A well-formed challenge, but for somebody else's wallet.
    h.server.forgedChallenge = challengeMessage({ wallet: empty.address, room: 'r', nonce: 'a'.repeat(32), iat: 1_793_000_000_000, exp: 1_793_000_060_000 });
    await expect(connect(h, 'Rex', 0, proofOf(holder))).rejects.toThrow('wallet');
    // Template for the right wallet but a lifetime far beyond the 60 s a challenge may have.
    h.server.forgedChallenge = challengeMessage({ wallet: holder.address, room: 'r', nonce: 'a'.repeat(32), iat: 1_793_000_000_000, exp: 1_793_000_000_000 + 3_600_000 });
    await expect(connect(h, 'Rex', 0, proofOf(holder))).rejects.toThrow('wallet');
    expect(signs).toHaveLength(0);
  });

  it('after a drop it resumes the seat without asking the wallet again', async () => {
    const { h, holder, signs, proofOf } = await proofSetup();
    const s = await connect(h, 'Rex', 0, proofOf(holder));
    pump(h, s, 300);
    const seat = s.welcome.playerId;
    vi.useFakeTimers();
    h.server.sockets.get(seat)!.drop();
    h.server.room.disconnect(seat);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.net.state).toBe('open');
    expect(s.net.welcome!.playerId).toBe(seat);
    expect(signs).toHaveLength(1);
    s.close();
  });

  it('after a drop it resumes the same seat with the token', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    const seat = s.welcome.playerId;
    vi.useFakeTimers();
    const sock = h.server.sockets.get(seat)!;
    sock.drop(); // network loss; the server did not see a clean close, so mark the grace period too
    h.server.room.disconnect(seat);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.net.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1100); // retry timer fires, the fake socket opens
    await vi.advanceTimersByTimeAsync(0);
    expect(s.net.state).toBe('open');
    expect(s.net.welcome!.playerId).toBe(seat);
    expect(h.server.room.seats.get(seat)!.connected).toBe(true);
    s.close();
  });
});

const wander = (t: number): Partial<InputSnapshot> => ({
  moveY: 1, moveX: Math.sin(t / 400) * 0.8, sprint: t % 3000 > 1500, stance: t > 6000 && t < 7000 ? 'crouch' : 'stand', jump: t % 1500 === 0,
});
const spin = (t: number): View => ({ yaw: Math.sin(t / 700) * 2.5, pitch: Math.sin(t / 900) * 0.3 });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('client prediction and reconciliation', () => {
  it('matches the server exactly with no latency: no corrections, errors below the tolerance', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 400);
    pump(h, s, 9000, wander, spin);
    pump(h, s, 800); // stop and let every command be acknowledged
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(s.predictor.stats.corrections).toBe(0);
    expect(s.predictor.stats.maxError).toBeLessThan(0.02);
    expect(dist(s.predictor.c.pos, server.pos)).toBeLessThan(0.02);
    expect(dist(s.mirror.self.pos, server.pos)).toBeLessThan(0.05);
  });

  it('still needs no corrections with 100 ms each way (replay of unacknowledged commands)', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    h.server.latencyMs = 100;
    pump(h, s, 800);
    pump(h, s, 9000, wander, spin);
    pump(h, s, 1200);
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(s.predictor.stats.corrections).toBe(0);
    expect(dist(s.predictor.c.pos, server.pos)).toBeLessThan(0.02);
  });

  it('own movement reacts at once while the server only confirms later', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 300);
    h.server.latencyMs = 150;
    pump(h, s, 1000);
    const start = { ...s.mirror.self.pos };
    pump(h, s, 200, { moveY: 1 }); // the first commands are still on their way (150 ms to arrive)
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(dist(s.mirror.self.pos, start)).toBeGreaterThan(0.4);
    expect(dist(server.pos, start)).toBeLessThan(0.3);
    pump(h, s, 1500, { moveY: 1 });
    s.close();
  });

  it('corrects, replays and smooths when the server disagrees', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 600);
    pump(h, s, 1000, { moveY: 1 });
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    server.pos.x += 1.2; // a push, a different collision result, ...
    pump(h, s, 100, { moveY: 1 });
    expect(s.predictor.stats.corrections).toBeGreaterThan(0);
    pump(h, s, 800, { moveY: 1 });
    pump(h, s, 400); // stop: the prediction is ahead of the server only by commands still in flight
    expect(dist(s.predictor.c.pos, server.pos)).toBeLessThan(0.05);
    expect(dist(s.mirror.self.pos, server.pos)).toBeLessThan(0.1);
    s.close();
  });

  it('spreads a correction over a few frames instead of jumping', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 600);
    pump(h, s, 1000, { moveY: 1 });
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    server.pos.x += 0.8;
    // Run frames one by one and watch the drawn position's largest single-frame step sideways.
    let maxStep = 0;
    let prev = s.mirror.self.pos.x;
    for (let i = 0; i < 12; i++) {
      pump(h, s, 50, { moveY: 1 });
      maxStep = Math.max(maxStep, Math.abs(s.mirror.self.pos.x - prev));
      prev = s.mirror.self.pos.x;
    }
    expect(s.predictor.stats.corrections).toBeGreaterThan(0);
    expect(maxStep).toBeLessThan(0.8); // not the whole 0.8 m in one frame
    s.close();
  });

  it('a respawn teleport snaps instead of sliding', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 600);
    pump(h, s, 800, { moveY: 1 });
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    server.pos.x = 30; server.pos.z = -30;
    pump(h, s, 300);
    expect(dist(s.predictor.c.pos, server.pos)).toBeLessThan(0.1);
    expect(Math.hypot(s.predictor.offset.x, s.predictor.offset.z)).toBe(0);
    s.close();
  });

  it('does not predict while downed and resumes after being revived', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 600);
    const server = h.server.room.match.combatants[s.welcome.playerId]!;
    server.health.state = 'downed';
    pump(h, s, 600, { moveY: 1 });
    const frozen = { ...s.mirror.self.pos };
    pump(h, s, 600, { moveY: 1 });
    expect(dist(s.mirror.self.pos, frozen)).toBeLessThan(0.05);
    server.health.state = 'alive'; server.health.hp = 50;
    pump(h, s, 1200, { moveY: 1 });
    expect(dist(s.mirror.self.pos, frozen)).toBeGreaterThan(1);
    pump(h, s, 400);
    expect(dist(s.predictor.c.pos, server.pos)).toBeLessThan(0.1);
    s.close();
  });
});

describe('NetClient basics', () => {
  it('rejects bad room ids and sends numbered inputs only when open', () => {
    expect(() => new NetClient({ baseUrl: 'ws://x', room: 'Bad Room!', name: 'a', cls: 0 })).toThrow();
    const h = setup();
    const c = new NetClient({ baseUrl: 'ws://fake', room: 'abcd', name: 'a', cls: 0, WebSocketImpl: h.ws, pingEveryMs: 1e9 });
    expect(c.sendInput(0, [{ moveX: 0, moveY: 0, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0 }])).toBe(false);
    c.close();
  });
});

describe('view time for lag compensation', () => {
  it('commands carry the match time being shown, so the server rewinds by about interpolation delay plus latency', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 600);
    h.server.latencyMs = 80;
    pump(h, s, 2500, { moveY: 1 });
    const seat = h.server.room.seats.get(s.welcome.playerId)!;
    const c = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(seat.lastCmd.vt).toBeDefined();
    expect(seat.lastCmd.vt!).toBeLessThan(h.server.room.match.time);
    // 120 ms interpolation + ~80 ms one way for the snapshot: roughly 0.2 s behind (clamped to 0.25).
    expect(c.lag).toBeGreaterThan(0.12);
    expect(c.lag).toBeLessThanOrEqual(MAX_REWIND_SECONDS);
    expect(seat.monitor.stats.dropped).toBe(0);
    s.close();
  });
  it('with no latency the rewind is just the interpolation delay', async () => {
    const h = setup();
    const s = await connect(h);
    pump(h, s, 2000, { moveY: 1 });
    const c = h.server.room.match.combatants[s.welcome.playerId]!;
    expect(c.lag).toBeGreaterThan(0.08);
    expect(c.lag).toBeLessThan(0.25); // no network delay: interpolation delay plus the command queue
    s.close();
  });
});

describe('lag compensation end to end', () => {
  /** A stationary client with perfect aim at the target AS IT IS SHOWN (interpolated, in the past, one frame stale) against a slowly strafing target. */
  async function duel(lagCompensation: boolean): Promise<{ shots: number; hits: number }> {
    const h = setup(lagCompensation);
    const s = await connect(h);
    const me = s.welcome.playerId;
    const room = h.server.room;
    const t = room.join('Target', PlayerClass.Soldier);
    if (!t.ok) throw new Error('no seat');
    const target = t.seat.id;
    room.match.combatants[me]!.pos = { x: 0, y: 0.02, z: 37 };
    room.match.combatants[target]!.pos = { x: 0, y: 0.02, z: 26 };
    pump(h, s, 600);
    h.server.latencyMs = 60;
    let seq = 0;
    const aimAtShown = (): View => {
      const mine = s.mirror.self.pos;
      const shown = s.mirror.match.combatants[target]!.pos;
      const dx = shown.x - mine.x, dz = shown.z - mine.z;
      return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(1.25 - 1.63, Math.hypot(dx, dz)) };
    };
    // Short taps (about two rounds, then a pause) so recoil never builds up: the client cannot see the server's recoil.
    for (let tick = 0; tick < 600; tick++) {
      // The target strafes left and right (0.7 s each way) and stays on the open yard.
      // A hit downs the target; stand it up again so every shot is a fair test of the aim.
      const th = room.match.combatants[target]!.health;
      th.hp = 100; th.state = 'alive'; th.downedTimer = 0; th.downedDamage = 0;
      const dir = Math.floor(tick / 14) % 2 === 0 ? 1 : -1;
      room.input(target, { t: 'input', seq, cmds: Array.from({ length: 3 }, () => ({ moveX: dir * 0.4, moveY: 0, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0 as const })) });
      seq += 3;
      pump(h, s, 50, { fire: tick % 10 === 0, aim: true }, aimAtShown());
    }
    const st = room.seats.get(me)!.monitor.stats;
    s.close();
    return { shots: st.shots, hits: st.hits };
  }

  it('hits a strafing target far more often than without compensation', async () => {
    const withComp = await duel(true);
    const without = await duel(false);
    console.log('duel:', JSON.stringify({ withComp, without }));
    expect(withComp.shots).toBeGreaterThan(25);
    expect(withComp.hits).toBeGreaterThan(without.hits * 2);
    expect(withComp.hits / withComp.shots).toBeGreaterThan(0.6);
  });
});
