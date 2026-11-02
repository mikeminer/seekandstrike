import type { MoveCmd } from './sim/playerMove';
import { SIG_B64_RE, WALLET_RE } from './passProof';

/**
 * Wire protocol shared by client and server (v2). Version-gated JSON; the server is authoritative:
 * clients send only their inputs and view angles, the server runs the shared simulation and sends
 * snapshots. A compact binary encoding is planned before public online testing.
 */
export const PROTOCOL_VERSION = 2;

/** Upper bound for any client->server frame accepted by the room (bytes). */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;
/** Most commands one input message may carry (about 4 are sent per message at 15 Hz). */
export const MAX_CMDS_PER_MESSAGE = 10;

/**
 * Client input: a batch of 60 Hz commands. `seq` numbers the first command; the others follow (seq+1, ...).
 * The server consumes them in order, one per 60 Hz step, and echoes the last consumed number as `ack` in snapshots.
 */
export interface InputMessage {
  t: 'input';
  seq: number;
  cmds: MoveCmd[];
}

export type ClientMessage =
  | { t: 'hello'; v: number; name?: string; cls?: number; resumeToken?: string; wallet?: string }
  /** Answer to a `challenge`: base64 Ed25519 signature (64 bytes) of the challenge text by the wallet named in `hello`. */
  | { t: 'auth'; sig: string }
  | { t: 'ping'; id: number }
  | InputMessage;

export type ErrorCode =
  | 'bad_version' | 'bad_message' | 'room_full' | 'not_implemented' | 'pass_required' | 'rate_limited' | 'not_joined'
  | 'proof_invalid' | 'proof_expired' | 'pass_unavailable' | 'pass_expired';

/** One player in a snapshot (numbers rounded to keep frames small). */
export interface SnapPlayer {
  id: number;
  tm: 0 | 1;
  cl: number;
  n: string;
  x: number; y: number; z: number;
  yw: number; pt: number;
  /** 0 stand, 1 crouch, 2 prone. */
  st: 0 | 1 | 2;
  /** 0 alive, 1 downed, 2 dead. */
  lf: 0 | 1 | 2;
  hp: number;
  sp: number;
  /** Human (1) or bot (0). */
  hu: 0 | 1;
  k: number; d: number;
  /** Present (1) only while reloading / holding aim, so others' animations match; omitted otherwise. */
  rl?: 1; ad?: 1;
  /** Present (1) while the secondary weapon is in hand. */
  ws?: 1;
}

export interface SnapSelf {
  hp: number; mag: number; reserve: number; grenades: number; stamina: number; reloading: boolean;
  /** Exact movement state for client prediction: position, velocity, stance, stance timer, flags (3 decimals). */
  mv: { x: number; y: number; z: number; vx: number; vy: number; vz: number; yw: number; pt: number; st: 0 | 1 | 2; stt: number; g: 0 | 1; sp: 0 | 1 };
}

export type SnapEvent =
  | { e: 'shot'; by: number; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { e: 'impact'; x: number; y: number; z: number; mat: string; tgt?: number }
  | { e: 'damage'; by: number; vic: number; amt: number; zone: string; out: string }
  | { e: 'grenade'; by: number; x: number; y: number; z: number }
  | { e: 'rocket'; by: number; x: number; y: number; z: number }
  | { e: 'explosion'; by: number; x: number; y: number; z: number }
  | { e: 'revive'; by: number; vic: number }
  | { e: 'resupply'; by: number; vic: number; n: number }
  | { e: 'objective'; ev: string }
  | { e: 'wave'; tm: 0 | 1 }
  | { e: 'matchEnd'; winner: 0 | 1 };

export interface Snapshot {
  t: 'snap';
  tick: number;
  /** Match time in seconds. */
  time: number;
  /** Last input sequence processed for the receiving player. */
  ack: number;
  you: number;
  self: SnapSelf;
  players: SnapPlayer[];
  /** `r: 1` marks a launcher rocket. */
  grenades: { id: number; x: number; y: number; z: number; r?: 1 }[];
  obj: { charge: string; progress: number; fuse: number; clock: number; phase: string };
  ev: SnapEvent[];
}

export type ServerMessage =
  | { t: 'welcome'; v: number; roomId: string; serverTickHz: number; snapshotHz: number; playerId: number; team: 0 | 1; cls: number; resumeToken: string; mapId: string }
  | { t: 'pong'; id: number; serverTime: number }
  /** Sent after `hello` when the room requires a Daily Pass: sign `message` with the wallet and answer with `auth`. */
  | { t: 'challenge'; message: string; expiresInMs: number }
  | { t: 'error'; code: ErrorCode }
  | { t: 'roundEnd'; winner: 0 | 1; restartInMs: number }
  | Snapshot;

/** Validates one command; unknown fields are dropped and absent flags are false. */
export function parseCmd(raw: unknown): MoveCmd | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!isNum(m.moveX, -1, 1) || !isNum(m.moveY, -1, 1) || !isNum(m.yaw, -1e4, 1e4) || !isNum(m.pitch, -2, 2)) return null;
  if (m.stance !== 0 && m.stance !== 1 && m.stance !== 2) return null;
  const flag = (v: unknown): boolean | null => (v === undefined ? false : typeof v === 'boolean' ? v : null);
  const sprint = flag(m.sprint), aim = flag(m.aim), fire = flag(m.fire), interact = flag(m.interact);
  const jump = flag(m.jump), reload = flag(m.reload), tapOut = flag(m.tapOut), grenade = flag(m.grenade), weapon = flag(m.weapon);
  if ([sprint, aim, fire, interact, jump, reload, tapOut, grenade, weapon].some((f) => f === null)) return null;
  const out: MoveCmd = { moveX: m.moveX, moveY: m.moveY, yaw: m.yaw, pitch: m.pitch, stance: m.stance, sprint: sprint!, aim: aim!, fire: fire!, interact: interact! };
  if (m.vt !== undefined) {
    if (!isNum(m.vt, 0, 1e6)) return null;
    out.vt = m.vt;
  }
  if (jump) out.jump = true;
  if (reload) out.reload = true;
  if (tapOut) out.tapOut = true;
  if (grenade) out.grenade = true;
  if (weapon) out.weapon = true;
  return out;
}

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.t === 'hello' && Number.isSafeInteger(m.v)) {
    const out: { t: 'hello'; v: number; name?: string; cls?: number; resumeToken?: string; wallet?: string } = { t: 'hello', v: m.v as number };
    if (typeof m.wallet === 'string' && WALLET_RE.test(m.wallet)) out.wallet = m.wallet;
    if (typeof m.resumeToken === 'string' && m.resumeToken.length <= 64) out.resumeToken = m.resumeToken;
    if (typeof m.name === 'string') out.name = m.name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
    if (Number.isInteger(m.cls) && isNum(m.cls, 0, 4)) out.cls = m.cls as number;
    return out;
  }
  if (m.t === 'auth' && typeof m.sig === 'string' && SIG_B64_RE.test(m.sig)) return { t: 'auth', sig: m.sig };
  if (m.t === 'ping' && Number.isSafeInteger(m.id)) return { t: 'ping', id: m.id as number };
  if (m.t === 'input') {
    if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0 || !Array.isArray(m.cmds) || m.cmds.length < 1 || m.cmds.length > MAX_CMDS_PER_MESSAGE) return null;
    const cmds: MoveCmd[] = [];
    for (const raw of m.cmds) {
      const c = parseCmd(raw);
      if (!c) return null;
      cmds.push(c);
    }
    return { t: 'input', seq: m.seq as number, cmds };
  }
  return null;
}
