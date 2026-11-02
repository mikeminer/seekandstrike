/**
 * The movement part of a player step, shared by the server (authoritative) and the client (prediction),
 * so both run exactly the same code on exactly the same inputs. A command is one 60 Hz step of input.
 */
import type { Combatant } from './combatant';
import type { SimHost } from './match';
import { applyCollisionResult, stepMovement, type Stance } from './movement';
import { clamp, v3, wrapAngle } from './vec';

export const STEP_SECONDS = 1 / 60;
/** Fastest the view may turn (rad/s): flicks are allowed, instant 180 degree snaps are not. */
export const MAX_TURN_RAD_PER_SEC = 14;
export const MAX_TURN_PER_STEP = MAX_TURN_RAD_PER_SEC * STEP_SECONDS;

/** One simulation step of player input. Presses (`jump`, `reload`, `tapOut`, `grenade`) apply to this step only. */
export interface MoveCmd {
  moveX: number;
  moveY: number;
  /** Wanted view angles (radians, yaw 0 faces -Z); the sim turns toward them at a bounded rate. */
  yaw: number;
  pitch: number;
  sprint: boolean;
  aim: boolean;
  fire: boolean;
  interact: boolean;
  /** 0 stand, 1 crouch, 2 prone. */
  stance: 0 | 1 | 2;
  /**
   * View time: the match time (s) of the world the client was showing when it issued this command. The server uses it for
   * lag compensation (clamped; a value from the future or from long ago is ignored).
   */
  vt?: number;
  jump?: boolean;
  reload?: boolean;
  tapOut?: boolean;
  grenade?: boolean;
  /** Switch primary ↔ secondary weapon (one press). */
  weapon?: boolean;
}

const STANCES: readonly Stance[] = ['stand', 'crouch', 'prone'];

/** Writes a command into the combatant's input (including the bounded look delta). */
export function applyCmdToInput(c: Combatant, cmd: MoveCmd): void {
  const inp = c.input;
  inp.moveX = cmd.moveX; inp.moveY = cmd.moveY;
  inp.sprint = cmd.sprint && cmd.moveY > 0.5;
  inp.aim = cmd.aim; inp.fire = cmd.fire; inp.interact = cmd.interact;
  inp.wantStance = STANCES[cmd.stance]!;
  inp.jump = !!cmd.jump; inp.reload = !!cmd.reload; inp.tapOut = !!cmd.tapOut; inp.throwGrenade = !!cmd.grenade; inp.switchWeapon = !!cmd.weapon;
  inp.lookYaw = clamp(wrapAngle(cmd.yaw - c.yaw), -MAX_TURN_PER_STEP, MAX_TURN_PER_STEP);
  inp.lookPitch = clamp(clamp(cmd.pitch, -1.45, 1.45) - c.pitch, -MAX_TURN_PER_STEP, MAX_TURN_PER_STEP);
}

/**
 * Turns the view by the input's look delta (humans only; bots set yaw directly), advances velocity, stance and
 * stamina, resolves collision through the host and updates position and speed.
 */
export function stepCombatantMovement(c: Combatant, host: SimHost, dt: number): void {
  const inp = c.input;
  if (!c.isBot) {
    c.yaw += inp.lookYaw;
    c.pitch = clamp(c.pitch + inp.lookPitch, -1.45, 1.45);
  }
  const disp = stepMovement(c.move, inp, c.yaw, dt, (s) => host.canTakeStance?.(c, s) ?? true);
  const r = host.moveCharacter(c, disp, dt);
  const applied = v3(r.pos.x - c.pos.x, r.pos.y - c.pos.y, r.pos.z - c.pos.z);
  applyCollisionResult(c.move, disp, applied, r.grounded, dt);
  c.speed = Math.hypot(applied.x, applied.z) / dt;
  c.pos = r.pos;
}
