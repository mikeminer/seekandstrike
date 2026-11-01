import { createCombatant, type Combatant } from '@shared/sim/combatant';
import { AabbHost } from '@shared/sim/match';
import { applyCmdToInput, stepCombatantMovement, STEP_SECONDS, type MoveCmd } from '@shared/sim/playerMove';
import type { SnapSelf } from '@shared/protocol';
import type { MapDef } from '@shared/map/types';
import { type Vec3, v3 } from '@shared/sim/vec';

/** Server movement state from a snapshot (`SnapSelf.mv`) plus stamina. */
export type ServerMove = SnapSelf['mv'] & { stamina: number };

interface Frame {
  seq: number;
  cmd: MoveCmd;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  stance: 0 | 1 | 2;
  stanceTimer: number;
  stamina: number;
  sprinting: boolean;
  grounded: boolean;
}

const STANCES = ['stand', 'crouch', 'prone'] as const;
const MAX_FRAMES = 240;
/** Below these errors the prediction is considered right and nothing is corrected (the server rounds to 1 mm). */
const POS_TOLERANCE = 0.02;
const VEL_TOLERANCE = 0.2;
/** A correction larger than this is a teleport (respawn): snap instead of smoothing. */
const SNAP_DISTANCE = 2;

/**
 * Client-side prediction of the local player's movement. It runs the SAME shared code as the server
 * (`applyCmdToInput` + `stepCombatantMovement` on the same collision host, one 60 Hz step per command) so the
 * prediction normally matches the server exactly. When a snapshot says otherwise (the server clamped the turn,
 * a command arrived late, a respawn) the state is reset to the server's and the not yet acknowledged commands
 * are replayed on top; the visible jump is spread over a few frames (`offset`).
 */
export class Predictor {
  readonly c: Combatant;
  private readonly host: AabbHost;
  private frames: Frame[] = [];
  /** Visual correction still to be absorbed (added to the predicted position, decays to zero). */
  offset = v3();
  stats = { corrections: 0, hardResets: 0, maxError: 0, lastError: 0 };

  constructor(map: MapDef, cls: number) {
    this.host = new AabbHost(map);
    this.c = createCombatant(0, 0, false, 'pred', cls as never);
  }

  private load(s: ServerMove): void {
    const c = this.c;
    c.pos = v3(s.x, s.y, s.z);
    c.yaw = s.yw;
    c.pitch = s.pt;
    c.move.vel = v3(s.vx, s.vy, s.vz);
    c.move.stance = STANCES[s.st];
    c.move.stanceTimer = s.stt;
    c.move.stamina = s.stamina;
    c.move.sprinting = s.sp === 1;
    c.move.grounded = s.g === 1;
  }

  private snapshotFrame(seq: number, cmd: MoveCmd): Frame {
    const c = this.c;
    return {
      seq, cmd, pos: v3(c.pos.x, c.pos.y, c.pos.z), vel: v3(c.move.vel.x, c.move.vel.y, c.move.vel.z), yaw: c.yaw, pitch: c.pitch,
      stance: STANCES.indexOf(c.move.stance) as 0 | 1 | 2, stanceTimer: c.move.stanceTimer, stamina: c.move.stamina,
      sprinting: c.move.sprinting, grounded: c.move.grounded,
    };
  }

  private run(cmd: MoveCmd): void {
    applyCmdToInput(this.c, cmd);
    stepCombatantMovement(this.c, this.host, STEP_SECONDS);
  }

  /** Adopts the server's state outright (join, respawn, downed). */
  reset(s: ServerMove): void {
    this.load(s);
    this.frames = [];
    this.offset = v3();
    this.stats.hardResets++;
  }

  /** Predicts one command locally (call once per 60 Hz step, after queueing it for sending). */
  predict(seq: number, cmd: MoveCmd): void {
    this.run(cmd);
    this.frames.push(this.snapshotFrame(seq, cmd));
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /** Compares the server's state after command `ack` with ours; on a mismatch resets and replays the rest. */
  reconcile(ack: number, server: ServerMove): void {
    if (ack < 0) return; // the server has not consumed a command yet
    while (this.frames.length > 0 && this.frames[0]!.seq < ack) this.frames.shift();
    const f = this.frames[0];
    if (!f || f.seq !== ack) {
      // Our history does not reach back to that command: take the server's state as is.
      this.reset(server);
      return;
    }
    const err = Math.hypot(f.pos.x - server.x, f.pos.y - server.y, f.pos.z - server.z);
    const velErr = Math.hypot(f.vel.x - server.vx, f.vel.y - server.vy, f.vel.z - server.vz);
    this.stats.lastError = err;
    this.stats.maxError = Math.max(this.stats.maxError, err);
    if (err <= POS_TOLERANCE && velErr <= VEL_TOLERANCE && f.stance === server.st) {
      this.frames.shift(); // acknowledged and correct
      return;
    }
    // Mismatch: rewind to the server state and replay everything it has not seen yet.
    const before = v3(this.c.pos.x + this.offset.x, this.c.pos.y + this.offset.y, this.c.pos.z + this.offset.z);
    this.load(server);
    const pending = this.frames.slice(1);
    this.frames = [];
    for (const p of pending) {
      this.run(p.cmd);
      this.frames.push(this.snapshotFrame(p.seq, p.cmd));
    }
    const dx = before.x - this.c.pos.x, dy = before.y - this.c.pos.y, dz = before.z - this.c.pos.z;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) this.offset = v3();
    else this.offset = v3(dx, dy, dz);
    this.stats.corrections++;
  }

  /** Position to draw: the predicted one plus the part of a correction not yet absorbed. */
  get position(): Vec3 {
    return v3(this.c.pos.x + this.offset.x, this.c.pos.y + this.offset.y, this.c.pos.z + this.offset.z);
  }

  /** Absorbs the visual correction (exponential decay, about 80 ms). */
  smooth(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
    if (Math.hypot(this.offset.x, this.offset.y, this.offset.z) < 0.0005) this.offset = v3();
  }
}
