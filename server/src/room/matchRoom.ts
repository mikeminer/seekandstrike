import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL_VERSION, parseClientMessage, type ClientMessage, type ErrorCode, type ServerMessage } from '@shared/protocol';
import { MAX_PLAYERS_PER_ROOM, SERVER_SNAPSHOT_HZ, SERVER_TICK_HZ } from '@shared/constants';
import type { PlayerClass } from '@shared/sim/etClasses';
import type { RpcEnv } from '../rpc/handler';
import { PROOF_TTL_MS } from '@shared/passProof';
import { RoomSim } from './roomSim';
import { ONLINE_MAP_IDS, roomMap, type OnlineMapId } from './map';
import type { Leaderboard } from '../leaderboard/leaderboard';
import { VoiceBudget, checkUp, relayDown, voiceRecipients } from '@shared/voice';
import { AccessGate, PassRegistry, RpcPassVerifier, passRpcFromUrl, type PendingAuth } from './access';

export interface Env extends RpcEnv {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
  /**
   * Online access policy. Anything but the literal "false" requires a Daily Pass proven to the server: the wallet signs
   * a challenge and the server reads the chain through RPC_UPSTREAM_URL (see access.ts). With no usable RPC configured
   * nobody gets in, so online is CLOSED by default.
   * For local testing without a wallet: `npm run server:dev:online` passes `--var ONLINE_REQUIRE_PASS:false`.
   */
  ONLINE_REQUIRE_PASS?: string;
  /** Workers Rate Limiting binding: wallet-proof attempts per client IP (each one can cost chain reads). */
  AUTH_LIMIT?: RateLimit;
}

/** Per-socket attachment (survives hibernation wake-ups). */
interface Attachment { seat: number | null; ip?: string; auth?: PendingAuth }

/** A socket that has not taken a seat by then is closed (it would otherwise hold one of the room's connection slots). */
const UNSEATED_TIMEOUT_MS = 15_000;
const MAX_MSGS_PER_SECOND = 60;
const newToken = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * One match room. The tick loop (setInterval, not alarms: alarms count as writes) runs only while at
 * least one human is seated, so an empty room can hibernate. State is in memory: if the object is evicted
 * the round ends and clients reconnect into a fresh one.
 */
export class MatchRoom extends DurableObject<Env> {
  private room: RoomSim | null = null;
  private sockets = new Map<number, WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastSnap = 0;
  private roundEndSent = false;
  private rate = new WeakMap<WebSocket, { windowStart: number; n: number }>();
  private voiceRate = new WeakMap<WebSocket, VoiceBudget>();
  private readonly passes = new PassRegistry();
  private gate: AccessGate | null = null;
  /** Map of this room, from the Worker's x-ss-map header (room name). */
  private mapId: OnlineMapId = 'banchina-est';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep the constructor tiny: it runs again after every hibernation wake-up.
    // Plain-text 'ping' is answered by the runtime without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const asked = request.headers.get('x-ss-map');
    if (!this.room && asked && (ONLINE_MAP_IDS as readonly string[]).includes(asked)) this.mapId = asked as OnlineMapId;
    if (this.ctx.getWebSockets().length >= MAX_PLAYERS_PER_ROOM) return new Response('Room full', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server); // Hibernation API, never server.accept()
    server.serializeAttachment({ seat: null, ip: (request.headers.get('cf-connecting-ip') ?? 'unknown').slice(0, 45) } satisfies Attachment);
    const wait = this.env.ONLINE_REQUIRE_PASS === 'false' ? UNSEATED_TIMEOUT_MS : UNSEATED_TIMEOUT_MS + PROOF_TTL_MS;
    setTimeout(() => {
      const a = server.deserializeAttachment() as Attachment | null;
      if (a && a.seat === null) { try { server.close(1008, 'timeout'); } catch { /* already closed */ } }
    }, wait);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket already closed */ }
  }
  private fail(ws: WebSocket, code: ErrorCode, close = false): void {
    this.send(ws, { t: 'error', code });
    if (close) { try { ws.close(1008, code); } catch { /* already closed */ } }
  }

  private allowed(ws: WebSocket): boolean {
    const now = Date.now();
    const r = this.rate.get(ws) ?? { windowStart: now, n: 0 };
    if (now - r.windowStart >= 1000) { r.windowStart = now; r.n = 0; }
    r.n++;
    this.rate.set(ws, r);
    return r.n <= MAX_MSGS_PER_SECOND;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return this.onVoice(ws, message);
    if (!this.allowed(ws)) return this.fail(ws, 'rate_limited', true);
    const msg = parseClientMessage(typeof message === 'string' ? message : null);
    if (!msg) return this.fail(ws, 'bad_message');
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { seat: null };

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', id: msg.id, serverTime: Date.now() });
    if (msg.t === 'hello') return this.onHello(ws, msg, att);
    if (msg.t === 'auth') return this.onAuth(ws, msg, att);
    if (att.seat === null || !this.room) return this.fail(ws, 'not_joined');
    this.room.input(att.seat, msg);
  }

  /**
   * Team voice (push-to-talk): a seated player's Opus packet goes, unchanged, to the connected teammates only.
   * Nothing is decoded, stored or logged. Malformed or over-budget packets are dropped silently.
   */
  private onVoice(ws: WebSocket, message: ArrayBuffer): void {
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { seat: null };
    if (att.seat === null || !this.room) return;
    const buf = new Uint8Array(message);
    if (!checkUp(buf)) return;
    let budget = this.voiceRate.get(ws);
    if (!budget) { budget = new VoiceBudget(); this.voiceRate.set(ws, budget); }
    if (!budget.allow(Date.now())) return;
    const room = this.room;
    const down = relayDown(buf, att.seat);
    for (const id of voiceRecipients(att.seat, (i) => room.match.combatants[i]?.team, this.sockets.keys())) {
      try { this.sockets.get(id)?.send(down); } catch { /* socket closing */ }
    }
  }

  private getGate(): AccessGate | null {
    if (this.gate) return this.gate;
    const rpc = passRpcFromUrl(this.env.RPC_UPSTREAM_URL);
    if (!rpc) return null;
    this.gate = new AccessGate({ roomId: this.ctx.id.toString(), verifier: new RpcPassVerifier(rpc) });
    return this.gate;
  }

  private async onHello(ws: WebSocket, msg: Extract<ClientMessage, { t: 'hello' }>, att: Attachment): Promise<void> {
    if (msg.v !== PROTOCOL_VERSION) return this.fail(ws, 'bad_version', true);
    if (att.seat !== null || att.auth) return this.fail(ws, 'bad_message');
    if (this.env.ONLINE_REQUIRE_PASS === 'false') return this.seat(ws, att, msg.name, msg.cls, msg.resumeToken, null);
    // Pass required. A dropped player whose pass is still valid takes the seat back without signing again.
    if (msg.resumeToken && this.room?.canResume(msg.resumeToken) && this.passes.resumable(msg.resumeToken, Date.now())) {
      return this.seat(ws, att, msg.name, msg.cls, msg.resumeToken, null);
    }
    const gate = this.getGate();
    if (!gate) return this.fail(ws, 'pass_unavailable', true);
    const ch = gate.begin(msg.wallet, { ...(msg.name !== undefined ? { name: msg.name } : {}), ...(msg.cls !== undefined ? { cls: msg.cls } : {}) });
    if (!ch) return this.fail(ws, 'pass_required', true);
    if (this.env.AUTH_LIMIT && !(await this.env.AUTH_LIMIT.limit({ key: att.ip ?? 'unknown' })).success) return this.fail(ws, 'rate_limited', true);
    ws.serializeAttachment({ ...att, auth: ch.pending } satisfies Attachment);
    this.send(ws, { t: 'challenge', message: ch.message, expiresInMs: ch.expiresInMs });
  }

  private async onAuth(ws: WebSocket, msg: Extract<ClientMessage, { t: 'auth' }>, att: Attachment): Promise<void> {
    const pending = att.auth;
    if (!pending || att.seat !== null) return this.fail(ws, 'bad_message');
    ws.serializeAttachment({ seat: null, ...(att.ip !== undefined ? { ip: att.ip } : {}) } satisfies Attachment); // a challenge answers once
    const gate = this.getGate();
    if (!gate) return this.fail(ws, 'pass_unavailable', true);
    const verdict = await gate.finish(pending, msg.sig);
    if (ws.readyState !== WebSocket.OPEN) return; // left while we were checking
    if (!verdict.ok) return this.fail(ws, verdict.error, true);
    // One wallet, one seat: a wallet that already sits here takes that seat over (a second device, or a lingering socket).
    let resume: string | undefined;
    const held = this.passes.holder(verdict.wallet);
    const heldSeat = held ? this.room?.seats.get(held.seat) : undefined;
    if (held && heldSeat && heldSeat.token === held.token) {
      this.room!.disconnect(held.seat);
      resume = held.token;
    }
    this.seat(ws, att, pending.name, pending.cls, resume, verdict);
  }

  /** Takes (or resumes) a seat for an admitted socket and sends the welcome. */
  private seat(ws: WebSocket, att: Attachment, name: string | undefined, cls: number | undefined, resumeToken: string | undefined, proof: { wallet: string; expiresAt: number } | null): void {
    const room = this.room ?? (this.room = new RoomSim({ map: roomMap(this.mapId), seed: (Date.now() ^ 0x5eec) >>> 0, now: () => Date.now(), token: newToken }));
    const r = room.join(name ?? '', (cls ?? 0) as PlayerClass, resumeToken);
    if (!r.ok) return this.fail(ws, r.error, true);
    if (proof) this.passes.grant(r.seat.id, r.seat.token, proof.wallet, proof.expiresAt);
    // A resumed seat replaces its old socket.
    const old = this.sockets.get(r.seat.id);
    if (old && old !== ws) { try { old.close(1000, 'replaced'); } catch { /* already closed */ } }
    this.sockets.set(r.seat.id, ws);
    ws.serializeAttachment({ seat: r.seat.id, ...(att.ip !== undefined ? { ip: att.ip } : {}) } satisfies Attachment);
    this.send(ws, {
      t: 'welcome', v: PROTOCOL_VERSION, roomId: this.ctx.id.toString(), serverTickHz: SERVER_TICK_HZ, snapshotHz: SERVER_SNAPSHOT_HZ,
      playerId: r.seat.id, team: r.team, cls: r.seat.cls, resumeToken: r.seat.token, mapId: this.mapId,
    });
    this.ensureLoop();
  }

  override async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.onGone(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing'); } catch { /* already closed */ }
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.onGone(ws);
  }

  private onGone(ws: WebSocket): void {
    const att = (ws.deserializeAttachment() as Attachment | null) ?? { seat: null };
    if (att.seat === null || !this.room) return;
    if (this.sockets.get(att.seat) === ws) {
      this.sockets.delete(att.seat);
      this.room.disconnect(att.seat); // grace period, then the slot goes back to a bot
    }
  }

  private ensureLoop(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.lastSnap = 0;
    this.timer = setInterval(() => this.onTick(), 1000 / SERVER_TICK_HZ);
  }

  private stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.room = null;
    this.sockets.clear();
    this.passes.clear();
    this.roundEndSent = false;
  }

  /** Weekly leaderboard: the finished round's verified players (Daily Pass wallets) with server-side stats. */
  private submitRound(room: RoomSim, winner: 0 | 1): void {
    const entries = [];
    for (const seat of room.seats.values()) {
      const wallet = this.passes.walletOf(seat.id);
      const c = room.match.combatants[seat.id];
      if (!wallet || !c) continue;
      entries.push({ wallet, name: seat.name, kills: c.kills, deaths: c.deaths, won: c.team === winner, map: this.mapId });
    }
    if (!entries.length || !this.env.LEADERBOARD) return;
    const stub = this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName('global'));
    this.ctx.waitUntil(stub.fetch('https://leaderboard/submit', { method: 'POST', body: JSON.stringify({ entries }) }).then(() => undefined, () => undefined));
  }

  private onTick(): void {
    const room = this.room;
    if (!room) return this.stopLoop();
    const now = Date.now();
    const dt = Math.min(250, now - this.lastTick);
    this.lastTick = now;
    const newRound = room.advance(dt);
    // Hard violations (a command flood): disconnect and free the seat.
    for (const seat of room.drainKicks()) {
      const ws = this.sockets.get(seat);
      this.sockets.delete(seat);
      if (ws) { this.fail(ws, 'rate_limited'); try { ws.close(1008, 'flood'); } catch { /* already closed */ } }
    }
    // A Daily Pass that ran out ends the seat (the current round is not held up for it).
    for (const g of this.passes.expired(now)) {
      this.passes.drop(g.seat);
      if (room.seats.get(g.seat)?.token !== g.token) continue; // the seat was released and reused meanwhile
      const ws = this.sockets.get(g.seat);
      this.sockets.delete(g.seat);
      room.leave(g.seat);
      if (ws) { this.fail(ws, 'pass_expired'); try { ws.close(1008, 'pass expired'); } catch { /* already closed */ } }
    }
    if (room.humans === 0) return this.stopLoop(); // everyone left for good: let the object hibernate

    if (newRound) this.roundEndSent = false;
    if (room.roundEndsAt !== 0 && !this.roundEndSent) {
      this.roundEndSent = true;
      const end: ServerMessage = { t: 'roundEnd', winner: room.roundWinner ?? 1, restartInMs: Math.max(0, room.roundEndsAt - now) };
      for (const ws of this.sockets.values()) this.send(ws, end);
      this.submitRound(room, end.winner);
    }
    // Snapshots follow wall-clock time (timers jitter, so counting ticks would undershoot the rate).
    if (now - this.lastSnap >= 1000 / SERVER_SNAPSHOT_HZ - 8) {
      this.lastSnap = now;
      for (const [seat, snap] of room.snapshots()) {
        const ws = this.sockets.get(seat);
        if (ws) this.send(ws, snap);
      }
    }
  }
}
