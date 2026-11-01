/**
 * Infantry movement model (pure, deterministic). Collision is resolved by the host
 * (Rapier kinematic character controller on the client; same model on a future server).
 *
 * Mechanics follow the reference engine (ground/air acceleration + friction, stance speed
 * scales, stamina-limited sprint — see docs/et-reference.md) but values are re-tuned to
 * realistic SI figures for a loaded 2030 soldier instead of the arcade 320 u/s.
 */
import { accelerate, applyFriction } from './etMove';
import { clamp, type Vec3 } from './vec';

export type Stance = 'stand' | 'crouch' | 'prone';

export const MOVE = {
  gravity: 9.81,
  /** Jog with kit, m/s (reference run speed is ~8 m/s; real loaded jog ~4 m/s). */
  runSpeed: 4.2,
  sprintSpeed: 6.4,
  crouchSpeed: 1.9,
  proneSpeed: 0.75,
  adsSpeedScale: 0.6,
  backpedalScale: 0.75,
  groundAccel: 10,
  airAccel: 1.2,
  friction: 6,
  stopSpeed: 1.2,
  /** ~0.5 m hop with kit. */
  jumpVelocity: 3.3,
  stepHeight: 0.45,
  /** Seconds of continuous sprint from full stamina (reference: 20000 ms). */
  staminaMax: 8,
  staminaRegenPerSec: 1.1,
  staminaMinToSprint: 1.5,
  jumpStaminaCost: 1.0,
  capsuleRadius: 0.32,
  /** Full capsule heights per stance (m). */
  height: { stand: 1.8, crouch: 1.25, prone: 0.62 } as Record<Stance, number>,
  /** Eye height above feet (reference view heights 40/16/-8 above origin, scaled). */
  eye: { stand: 1.63, crouch: 1.08, prone: 0.4 } as Record<Stance, number>,
  stanceChangeSeconds: { stand: 0.25, crouch: 0.25, prone: 0.9 } as Record<Stance, number>,
} as const;

export interface MoveInput {
  /** Strafe right (+) / left (-), [-1, 1]. */
  moveX: number;
  /** Forward (+) / back (-), [-1, 1]. */
  moveY: number;
  sprint: boolean;
  jump: boolean;
  aim: boolean;
  wantStance: Stance;
}

export interface MoveState {
  vel: Vec3;
  stance: Stance;
  /** Seconds remaining before the stance transition completes (blocks sprint/jump). */
  stanceTimer: number;
  stamina: number;
  sprinting: boolean;
  grounded: boolean;
  /** Stamina capacity in seconds (class modifier). */
  staminaMax: number;
}

export const createMoveState = (staminaMax: number = MOVE.staminaMax): MoveState => ({
  vel: { x: 0, y: 0, z: 0 },
  stance: 'stand',
  stanceTimer: 0,
  stamina: staminaMax,
  sprinting: false,
  grounded: true,
  staminaMax,
});

export function stanceSpeed(stance: Stance): number {
  return stance === 'stand' ? MOVE.runSpeed : stance === 'crouch' ? MOVE.crouchSpeed : MOVE.proneSpeed;
}

/**
 * Advances velocity/stance/stamina one fixed step. Returns the displacement the host should
 * try to apply (it then reports `grounded` back via `state.grounded` for the next step).
 * `canStand(stance)` lets the host veto standing up under a low ceiling.
 */
export function stepMovement(
  s: MoveState,
  input: MoveInput,
  yaw: number,
  dt: number,
  canChangeTo: (stance: Stance) => boolean = () => true,
): Vec3 {
  // Stance transitions (prone takes longer, like the reference).
  if (input.wantStance !== s.stance && s.stanceTimer <= 0 && canChangeTo(input.wantStance)) {
    s.stanceTimer = Math.max(MOVE.stanceChangeSeconds[input.wantStance], MOVE.stanceChangeSeconds[s.stance]) *
      (input.wantStance === 'prone' || s.stance === 'prone' ? 1 : 0.6);
    s.stance = input.wantStance;
  }
  if (s.stanceTimer > 0) s.stanceTimer = Math.max(0, s.stanceTimer - dt);

  const mx = clamp(input.moveX, -1, 1);
  const my = clamp(input.moveY, -1, 1);
  const mag = Math.min(1, Math.hypot(mx, my));
  const forwardish = my > 0.3 && Math.abs(mx) < my;

  const sprintAllowed = s.stance === 'stand' && s.stanceTimer <= 0 && !input.aim && forwardish && s.grounded;
  if (input.sprint && sprintAllowed && (s.sprinting ? s.stamina > 0 : s.stamina >= MOVE.staminaMinToSprint)) {
    s.sprinting = true;
  } else {
    s.sprinting = false;
  }
  if (s.sprinting) s.stamina = Math.max(0, s.stamina - dt);
  else s.stamina = Math.min(s.staminaMax, s.stamina + MOVE.staminaRegenPerSec * dt);

  let speed = s.sprinting ? MOVE.sprintSpeed : stanceSpeed(s.stance);
  if (input.aim) speed *= MOVE.adsSpeedScale;
  if (my < 0) speed *= MOVE.backpedalScale;
  if (s.stanceTimer > 0) speed *= 0.5;

  // Wish direction in world space (yaw 0 faces -Z).
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let wx = 0;
  let wz = 0;
  if (mag > 0.0001) {
    const nx = mx / Math.max(mag, Math.hypot(mx, my));
    const ny = my / Math.max(mag, Math.hypot(mx, my));
    wx = nx * cos - ny * sin;
    wz = -nx * sin - ny * cos;
  }
  const wishSpeed = speed * mag;

  const v = s.vel;
  if (s.grounded) {
    applyFriction(v, MOVE.friction, MOVE.stopSpeed, dt);
    accelerate(v, { x: wx, y: 0, z: wz }, wishSpeed, MOVE.groundAccel, dt);
    if (v.y < 0) v.y = 0;
    if (input.jump && s.stance === 'stand' && s.stanceTimer <= 0 && s.stamina >= MOVE.jumpStaminaCost) {
      v.y = MOVE.jumpVelocity;
      s.stamina -= MOVE.jumpStaminaCost;
      s.grounded = false;
    }
  } else {
    accelerate(v, { x: wx, y: 0, z: wz }, wishSpeed, MOVE.airAccel, dt);
  }
  if (!s.grounded) v.y -= MOVE.gravity * dt;

  return { x: v.x * dt, y: v.y * dt, z: v.z * dt };
}

/** Called by the host after collision: zero velocity components blocked by geometry. */
export function applyCollisionResult(s: MoveState, wanted: Vec3, applied: Vec3, grounded: boolean, dt: number): void {
  if (dt > 0) {
    if (Math.abs(applied.x - wanted.x) > 1e-5) s.vel.x = applied.x / dt;
    if (Math.abs(applied.z - wanted.z) > 1e-5) s.vel.z = applied.z / dt;
    if (wanted.y > 0 && applied.y < wanted.y - 1e-5) s.vel.y = 0; // head bump
  }
  s.grounded = grounded && s.vel.y <= 0.01;
  if (s.grounded && s.vel.y < 0) s.vel.y = 0;
}
