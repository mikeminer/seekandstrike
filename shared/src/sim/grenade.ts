/**
 * Fragmentation grenade (pure, deterministic): thrown on a lofted arc, bounces on the ground and map
 * boxes, explodes when the fuse ends. Damage falls off with distance and needs line of sight from
 * the blast to the target (walls and containers shield). Original code; fuse and ranges are tuned
 * for the 2030 setting, not taken from the reference engine.
 */
import type { MapDef } from '../map/types';
import { type Vec3, v3, dirFromYawPitch } from './vec';

export const GRENADE = {
  fuseSeconds: 3,
  throwSpeed: 14,
  /** Extra upward angle added to the aim pitch (rad): grenades are lobbed. */
  liftRad: 0.2,
  gravity: 9.81,
  radius: 0.06,
  restitution: 0.38,
  /** Horizontal speed kept after each bounce. */
  surfaceFriction: 0.7,
  restSpeed: 0.5,
  /** Full damage inside `lethalRadius`, linear fall-off to 0 at `blastRadius`. */
  lethalRadius: 2.2,
  blastRadius: 6,
  maxDamage: 160,
  /** Blast damage the thrower takes (teammates take none). */
  selfScale: 0.5,
  cooldownSeconds: 1,
  /** Sub-step length for collision (m/s * s must stay well below the box thickness). */
  maxSubstep: 1 / 180,
} as const;

export interface Grenade {
  id: number;
  ownerId: number;
  team: 0 | 1;
  pos: Vec3;
  vel: Vec3;
  fuse: number;
  alive: boolean;
  bounces: number;
}

/** Throw direction: aim yaw/pitch plus the lob angle. */
export function throwGrenade(id: number, ownerId: number, team: 0 | 1, origin: Vec3, yaw: number, pitch: number, ownerVel: Vec3): Grenade {
  const d = dirFromYawPitch(yaw, pitch + GRENADE.liftRad);
  return {
    id, ownerId, team,
    pos: v3(origin.x + d.x * 0.4, origin.y + d.y * 0.4, origin.z + d.z * 0.4),
    vel: v3(d.x * GRENADE.throwSpeed + ownerVel.x * 0.5, d.y * GRENADE.throwSpeed + ownerVel.y * 0.5, d.z * GRENADE.throwSpeed + ownerVel.z * 0.5),
    fuse: GRENADE.fuseSeconds, alive: true, bounces: 0,
  };
}

/** Horizontal distance a grenade thrown at total angle `theta` (rad) travels before first touching flat ground. */
function throwRange(theta: number, releaseHeight: number): number {
  const v = GRENADE.throwSpeed, g = GRENADE.gravity;
  const vy = v * Math.sin(theta);
  return v * Math.cos(theta) * (vy + Math.sqrt(vy * vy + 2 * g * releaseHeight)) / g;
}

/**
 * Aim pitch (rad) for a throw from `releaseHeight` m above flat ground that first touches down about
 * `distance` m away, or null if out of range. The lob angle is already subtracted.
 */
export function pitchForDistance(distance: number, releaseHeight = 1.6): number | null {
  let lo = -0.5, hi = 0.7; // range grows with the angle in this interval
  if (distance < throwRange(lo, releaseHeight) || distance > throwRange(hi, releaseHeight)) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (throwRange(mid, releaseHeight) < distance) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2 - GRENADE.liftRad;
}

/** Blast damage at `distance` metres from the centre (before line of sight). */
export function blastDamage(distance: number): number {
  if (distance >= GRENADE.blastRadius) return 0;
  if (distance <= GRENADE.lethalRadius) return GRENADE.maxDamage;
  return GRENADE.maxDamage * (1 - (distance - GRENADE.lethalRadius) / (GRENADE.blastRadius - GRENADE.lethalRadius));
}

/**
 * Advances the grenade by `dt`: fuse, gravity and collisions. Returns the number of bounces this step
 * (for sound). `alive` turns false when the fuse ends (the caller then explodes it) or it falls out of the world.
 */
export function stepGrenade(g: Grenade, dt: number, map: MapDef): number {
  g.fuse -= dt;
  let bounces = 0;
  const n = Math.max(1, Math.ceil(dt / GRENADE.maxSubstep));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    g.vel.y -= GRENADE.gravity * h;
    g.pos.x += g.vel.x * h; g.pos.y += g.vel.y * h; g.pos.z += g.vel.z * h;
    bounces += collide(g, map);
  }
  if (g.pos.y < -4) g.alive = false;
  g.bounces += bounces;
  return bounces;
}

const R = GRENADE.radius;

function bounceOff(g: Grenade, nx: number, ny: number, nz: number): number {
  const vn = g.vel.x * nx + g.vel.y * ny + g.vel.z * nz;
  if (vn >= 0) return 0;
  // Reflect the normal part with restitution, damp the tangent part.
  const tx = g.vel.x - vn * nx, ty = g.vel.y - vn * ny, tz = g.vel.z - vn * nz;
  const f = GRENADE.surfaceFriction;
  g.vel.x = tx * f - vn * GRENADE.restitution * nx;
  g.vel.y = ty * f - vn * GRENADE.restitution * ny;
  g.vel.z = tz * f - vn * GRENADE.restitution * nz;
  if (Math.hypot(g.vel.x, g.vel.y, g.vel.z) < GRENADE.restSpeed) { g.vel.x = 0; g.vel.y = 0; g.vel.z = 0; }
  return Math.abs(vn) > 1 ? 1 : 0;
}

function collide(g: Grenade, map: MapDef): number {
  let bounces = 0;
  // Ground (no ground over the water beyond the quay edge, like raycastStatic).
  if (g.pos.y < R && g.pos.x <= map.bounds.maxX + 0.5) {
    g.pos.y = R;
    bounces += bounceOff(g, 0, 1, 0);
  }
  for (const b of map.boxes) {
    const hx = b.s.x / 2, hy = b.s.y / 2, hz = b.s.z / 2;
    const dx = g.pos.x - b.c.x, dy = g.pos.y - b.c.y, dz = g.pos.z - b.c.z;
    const cx = Math.max(-hx, Math.min(hx, dx)), cy = Math.max(-hy, Math.min(hy, dy)), cz = Math.max(-hz, Math.min(hz, dz));
    let nx = dx - cx, ny = dy - cy, nz = dz - cz;
    const d2 = nx * nx + ny * ny + nz * nz;
    if (d2 >= R * R) continue;
    if (d2 < 1e-12) {
      // Centre inside the box: push out through the nearest face.
      const px = hx - Math.abs(dx), py = hy - Math.abs(dy), pz = hz - Math.abs(dz);
      if (px <= py && px <= pz) { nx = Math.sign(dx || 1); ny = 0; nz = 0; g.pos.x = b.c.x + nx * (hx + R); }
      else if (py <= pz) { nx = 0; ny = Math.sign(dy || 1); nz = 0; g.pos.y = b.c.y + ny * (hy + R); }
      else { nx = 0; ny = 0; nz = Math.sign(dz || 1); g.pos.z = b.c.z + nz * (hz + R); }
    } else {
      const d = Math.sqrt(d2);
      nx /= d; ny /= d; nz /= d;
      const push = R - d;
      g.pos.x += nx * push; g.pos.y += ny * push; g.pos.z += nz * push;
    }
    bounces += bounceOff(g, nx, ny, nz);
  }
  return bounces;
}
