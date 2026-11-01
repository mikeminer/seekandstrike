/*
===========================================================================

Wolfenstein: Enemy Territory GPL Source Code
Copyright (C) 1999-2010 id Software LLC, a ZeniMax Media company. 

This file is part of the Wolfenstein: Enemy Territory GPL Source Code (Wolf ET Source Code).  

Wolf ET Source Code is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Wolf ET Source Code is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Wolf ET Source Code.  If not, see <http://www.gnu.org/licenses/>.

In addition, the Wolf: ET Source Code is also subject to certain additional terms. You should have received a copy of these additional terms immediately following the terms and conditions of the GNU General Public License which accompanied the Wolf ET Source Code.  If not, please request a copy in writing from id Software at the address below.

If you have questions concerning this license or the applicable additional terms, you may contact in writing id Software LLC, c/o ZeniMax Media Inc., Suite 120, Rockville, Maryland 20850 USA.

===========================================================================
*/

/*
 * Modified for SEEK & STRIKE (2026) by Michele Angelo Forlani: translated from C to TypeScript
 * from bg_pmove.c (PM_ClipVelocity, PM_Friction, PM_Accelerate, PM_CmdScale, PM_Sprint).
 * Changes: pure functions on plain vectors instead of the pmove_t/playerState_t globals; values in
 * metres (the ET constants are kept in `ET_PM` in reference units and converted); time in seconds;
 * no water, ladder, slick-surface, knockback, dodge, spectator/noclip, AI-friction or powerup
 * branches; heavy-weapon speed scaling is left to the caller. This is NOT the original program.
 */
import { refToMetres } from '../units';
import { type Vec3 } from './vec';

/** Original constants of bg_pmove.c / bg_public.h, in reference units (see units.ts). */
export const ET_PM = {
  stopSpeed: 100,
  accelerate: 10,
  airAccelerate: 1,
  friction: 6,
  proneSpeedScale: 0.21,
  /** bg_public.h OVERCLIP. */
  overclip: 1.001,
  /** bg_public.h SPRINTTIME (ms of sprint at full stamina). */
  sprintTime: 20000,
  /** PM_Sprint: sprintTime drained per second while sprinting. */
  sprintDrainPerSec: 5000,
  /** PM_Sprint: base recharge per second, doubled above `sprintFastRechargeAbove`. */
  sprintRechargePerSec: 500,
  sprintFastRechargeAbove: 5000,
  /** PM_Sprint: Battle Sense level 2 recharge multiplier. */
  battleSenseRechargeScale: 1.6,
} as const;

/** ET velocities below 1 unit/s are snapped to rest by PM_Friction. */
export const ET_REST_SPEED_M = refToMetres(1);

/** PM_ClipVelocity: slides `v` along a surface; `overbounce` > 1 pushes slightly off it. */
export function clipVelocity(v: Vec3, normal: Vec3, overbounce: number = ET_PM.overclip): Vec3 {
  let backoff = v.x * normal.x + v.y * normal.y + v.z * normal.z;
  if (backoff < 0) backoff *= overbounce;
  else backoff /= overbounce;
  return { x: v.x - normal.x * backoff, y: v.y - normal.y * backoff, z: v.z - normal.z * backoff };
}

/**
 * PM_Friction, ground case: below `stopSpeed` the drop is computed as if moving at `stopSpeed`
 * so slow movement stops quickly. Horizontal only (ET ignores slope movement while walking).
 */
export function applyFriction(v: Vec3, friction: number, stopSpeed: number, dt: number, restSpeed: number = ET_REST_SPEED_M): void {
  const speed = Math.hypot(v.x, v.z);
  if (speed < restSpeed) {
    v.x = 0;
    v.z = 0;
    return;
  }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const newSpeed = Math.max(0, speed - drop) / speed;
  v.x *= newSpeed;
  v.z *= newSpeed;
}

/**
 * PM_Accelerate (Quake 2 style): adds speed along `wishdir` only up to `wishSpeed`.
 * `wishdir` must be a unit vector (or zero).
 */
export function accelerate(v: Vec3, wishdir: Vec3, wishSpeed: number, accel: number, dt: number): void {
  const currentSpeed = v.x * wishdir.x + v.y * wishdir.y + v.z * wishdir.z;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  let accelSpeed = accel * dt * wishSpeed;
  if (accelSpeed > addSpeed) accelSpeed = addSpeed;
  v.x += accelSpeed * wishdir.x;
  v.y += accelSpeed * wishdir.y;
  v.z += accelSpeed * wishdir.z;
}

/**
 * PM_CmdScale: scale factor for a movement command given as axial values in [-127, 127],
 * so diagonals are not sqrt(2) faster. `speed` is the player's base speed. The result is the
 * factor to multiply each command component by: |command| * result = speed * max / 127
 * (run/sprint scale and heavy-weapon scale are applied by the caller).
 */
export function cmdScale(forward: number, right: number, up: number, speed: number): number {
  const max = Math.max(Math.abs(forward), Math.abs(right), Math.abs(up));
  if (!max) return 0;
  const total = Math.sqrt(forward * forward + right * right + up * up);
  return (speed * max) / (127 * total);
}

export interface SprintOptions {
  /** True when the sprint button is held with a forward/side command, standing (not ducked or prone). */
  exerting: boolean;
  /** Battle Sense level 2 or higher. */
  battleSense?: boolean;
}

/**
 * PM_Sprint: advances the sprint timer (ms, 0..ET_PM.sprintTime) by `dt` seconds. Drains while
 * exerting; otherwise recharges, twice as fast above the 25% mark. Returns the new timer.
 */
export function stepSprintTime(sprintTime: number, dt: number, opts: SprintOptions): number {
  if (opts.exerting) return Math.max(0, sprintTime - ET_PM.sprintDrainPerSec * dt);
  const base = ET_PM.sprintRechargePerSec * (opts.battleSense ? ET_PM.battleSenseRechargeScale : 1);
  let t = sprintTime + base * dt;
  if (t > ET_PM.sprintFastRechargeAbove) t += base * dt;
  return Math.min(ET_PM.sprintTime, t);
}
