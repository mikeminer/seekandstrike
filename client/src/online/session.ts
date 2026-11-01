import { NetClient, type NetError, type NetHandlers, type NetState, type Welcome } from './netClient';
import { INTERP_DELAY_MS, SnapshotBuffer, interpolateGrenades, interpolatePoses } from './snapshots';
import { Mirror, type SelfView } from './mirror';
import { Predictor, type ServerMove } from './predictor';
import type { InputSnapshot } from '../input/input';
import type { SimEvent } from '@shared/sim/match';
import type { MapDef } from '@shared/map/types';
import type { Snapshot } from '@shared/protocol';
import { MAX_CMDS_PER_MESSAGE } from '@shared/protocol';
import { STEP_SECONDS, type MoveCmd } from '@shared/sim/playerMove';

/** A command batch is sent about every 66 ms (15 Hz) or as soon as 4 commands are waiting. */
const SEND_EVERY_MS = 66;
const SEND_WHEN_QUEUED = 4;
const MAX_STEPS_PER_FRAME = 5;
const MAX_OUTBOX = 60;
const STANCE_NUM = { stand: 0, crouch: 1, prone: 2 } as const;
/** Wire precision: the SAME rounded numbers are predicted locally and sent, so both ends see identical input. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export interface SessionOptions {
  baseUrl: string;
  room: string;
  name: string;
  cls: number;
  map: MapDef;
  /** Daily Pass proof (see NetOptions). */
  wallet?: string;
  sign?: (message: string) => Promise<string | null>;
  onState?: (s: NetState) => void;
  onError?: (code: NetError) => void;
  onRoundEnd?: (winner: 0 | 1, restartInMs: number) => void;
  /** Injectable for tests. */
  net?: (handlers: NetHandlers) => NetClient;
  now?: () => number;
}

interface Outgoing { seq: number; cmd: MoveCmd }

/**
 * Network, snapshot buffer, mirror match and movement prediction for one online game.
 * Own movement: one command per 60 Hz step is predicted locally and sent in batches; snapshots carry the server's
 * state after its last consumed command (`ack`) and the predictor reconciles against it. Everyone else is interpolated.
 */
export class OnlineSession {
  readonly buffer = new SnapshotBuffer();
  readonly predictor: Predictor;
  private pendingEvents: SimEvent[] = [];
  private stepAcc = 0;
  private sendAcc = 0;
  private nextSeq = 0;
  /** Match time of the world being shown for the other players (sent as `vt` for lag compensation). */
  private viewTime = -1;
  private outbox: Outgoing[] = [];
  /** True once the first snapshot initialised the predictor. */
  private ready = false;
  /** Whether the server currently has the player alive (prediction runs only then). */
  private predicting = false;
  roundEnd: { winner: 0 | 1; at: number } | null = null;

  private constructor(readonly net: NetClient, readonly mirror: Mirror, readonly welcome: Welcome, cls: number, map: MapDef, private readonly now: () => number) {
    this.predictor = new Predictor(map, cls);
  }

  static async connect(o: SessionOptions): Promise<OnlineSession> {
    const now = o.now ?? (() => performance.now());
    let session: OnlineSession | null = null;
    const handlers: NetHandlers = {
      onSnapshot: (s: Snapshot, at: number) => {
        if (!session) return;
        session.buffer.push(s, at);
        session.pendingEvents.push(...session.mirror.applyState(s));
        session.reconcile(s);
      },
      onRoundEnd: (winner: 0 | 1, restartInMs: number) => { if (session) session.roundEnd = { winner, at: now() + restartInMs }; o.onRoundEnd?.(winner, restartInMs); },
      onState: (s: NetState) => o.onState?.(s),
      onError: (c: NetError) => o.onError?.(c),
    };
    const net = o.net ? o.net(handlers) : new NetClient({
      baseUrl: o.baseUrl, room: o.room, name: o.name, cls: o.cls, now,
      ...(o.wallet ? { wallet: o.wallet } : {}), ...(o.sign ? { sign: o.sign } : {}),
    }, handlers);
    const welcome = await net.connect();
    session = new OnlineSession(net, new Mirror(o.map, welcome.playerId), welcome, o.cls, o.map, now);
    return session;
  }

  private reconcile(s: Snapshot): void {
    const me = s.players.find((p) => p.id === this.welcome.playerId);
    if (!me) return;
    const server: ServerMove = { ...s.self.mv, stamina: s.self.stamina };
    const alive = me.lf === 0;
    if (!alive) {
      // Downed or dead: the server does not move us. Follow it and wait for the next life.
      this.predictor.reset(server);
      this.predicting = false;
      this.ready = true;
    } else if (!this.ready || !this.predicting) {
      this.predictor.reset(server); // first snapshot, or back from dead
      this.predicting = true;
      this.ready = true;
    } else {
      this.predictor.reconcile(s.ack, server);
    }
  }

  /**
   * Called once per rendered frame: turns elapsed time into 60 Hz commands (predicted locally, queued for the
   * server), sends them in batches, blends snapshots for the other players and returns the sim events to play.
   * `view` is the local camera angle (kept client side).
   */
  update(frameMs: number, sample: () => InputSnapshot, consume: () => void, view: SelfView): SimEvent[] {
    const dt = Math.min(0.1, frameMs / 1000);
    const sample2 = this.buffer.sample(this.now() - INTERP_DELAY_MS);
    if (sample2) this.viewTime = sample2.a.time + (sample2.b.time - sample2.a.time) * sample2.t;
    if (this.ready) {
      this.stepAcc = Math.min(this.stepAcc + dt, STEP_SECONDS * MAX_STEPS_PER_FRAME);
      while (this.stepAcc >= STEP_SECONDS) {
        this.stepAcc -= STEP_SECONDS;
        const s = sample();
        consume();
        const cmd: MoveCmd = {
          moveX: r3(s.moveX), moveY: r3(s.moveY), yaw: r4(view.yaw), pitch: r4(view.pitch),
          sprint: s.sprint, aim: s.aim, fire: s.fire, interact: s.interact, stance: STANCE_NUM[s.stance],
        };
        if (this.viewTime >= 0) cmd.vt = r3(this.viewTime);
        if (s.jump) cmd.jump = true;
        if (s.reload) cmd.reload = true;
        if (s.tapOut) cmd.tapOut = true;
        if (s.grenade) cmd.grenade = true;
        const seq = this.nextSeq++;
        this.outbox.push({ seq, cmd });
        if (this.predicting) this.predictor.predict(seq, cmd);
      }
      if (this.outbox.length > MAX_OUTBOX) this.outbox.splice(0, this.outbox.length - MAX_OUTBOX);
      this.sendAcc += frameMs;
      if (this.outbox.length >= SEND_WHEN_QUEUED || (this.outbox.length > 0 && this.sendAcc >= SEND_EVERY_MS)) this.flush();
    }

    if (sample2) {
      this.mirror.applyPoses(interpolatePoses(sample2), undefined, view, dt);
      this.pendingEvents.push(...this.mirror.applyGrenades(interpolateGrenades(sample2)));
    }
    if (this.predicting) {
      this.predictor.smooth(dt);
      const c = this.predictor.c;
      this.mirror.applySelfPrediction(this.predictor.position, c.move.vel, c.move.stance, c.move.sprinting);
    } else if (this.ready) {
      const latest = this.buffer.latest?.self.mv;
      if (latest) this.mirror.applySelfPrediction({ x: latest.x, y: latest.y, z: latest.z }, { x: latest.vx, y: latest.vy, z: latest.vz }, 'stand', false);
    }
    this.mirror.tickLocal(dt, sample().aim, false);
    const ev = this.pendingEvents;
    this.pendingEvents = [];
    return ev;
  }

  private flush(): void {
    this.sendAcc = 0;
    const batch = this.outbox.slice(0, MAX_CMDS_PER_MESSAGE);
    if (!batch.length) return;
    if (this.net.sendInput(batch[0]!.seq, batch.map((b) => b.cmd))) this.outbox.splice(0, batch.length);
  }

  /** Whole seconds until the server starts the next round, or null while a round is being played. */
  restartIn(): number | null {
    const r = this.roundEnd;
    if (!r) return null;
    if (this.mirror.match.phase === 'playing') { this.roundEnd = null; return null; }
    return Math.max(0, Math.ceil((r.at - this.now()) / 1000));
  }

  get rtt(): number { return this.net.rtt; }
  close(): void { this.net.close(); }
}
