/**
 * Projectile ballistics (pure). Bullets are real projectiles: gravity drop, quadratic air
 * drag and time of flight, integrated in sub-steps with a segment raycast each sub-step so
 * fast rounds never tunnel. Thin penetrable materials (wood, sheet metal) let a round
 * continue with reduced velocity.
 */
import { type Vec3 } from './vec';

export type SurfaceMaterial = 'concrete' | 'asphalt' | 'metal' | 'sheetMetal' | 'wood' | 'flesh' | 'glass';

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  material: SurfaceMaterial;
  /** Thickness along the ray for penetration checks (m). Infinity for solid ground. */
  thickness: number;
  /** Geometric entry→exit distance along the ray (m); a penetrating round reappears beyond it. */
  span?: number;
  /** Set when a combatant was hit. */
  targetId?: number;
  zone?: HitZone;
}

export type HitZone = 'head' | 'torso' | 'limb';

/** Host-provided segment cast. `ignoreId` excludes the shooter. */
export type Raycast = (from: Vec3, dir: Vec3, maxDistance: number, ignoreId: number) => RayHit | null;

export interface BulletSpec {
  muzzleVelocity: number;
  /** k in a = -k |v| v  (k = rho * Cd * A / (2 m)), 1/m. */
  dragK: number;
  maxLifetime: number;
  /** Muzzle damage to an unarmoured torso. */
  baseDamage: number;
  /** Below this fraction of muzzle energy a round no longer counts as lethal. */
  minEnergyFraction: number;
}

export interface Projectile {
  id: number;
  ownerId: number;
  team: number;
  pos: Vec3;
  vel: Vec3;
  age: number;
  alive: boolean;
  /** Energy fraction lost so far to penetration (multiplies damage). */
  energyScale: number;
  /** Server only: seconds the shooter's view lagged behind; targets are tested where they were that long ago. */
  lag?: number;
  /** Weapon that fired it (damage and drag use its spec even if the shooter switches weapon meanwhile). */
  weapon?: string;
}

export interface ProjectileImpact {
  projectile: Projectile;
  hit: RayHit;
  /** Kinetic-energy-scaled damage at impact (before hit-zone multiplier). */
  damage: number;
  speed: number;
  penetrated: boolean;
}

/** Max thickness (m) a round at muzzle velocity can pass through, per material. */
export const PENETRATION_DEPTH: Record<SurfaceMaterial, number> = {
  concrete: 0,
  asphalt: 0,
  metal: 0.004,
  sheetMetal: 0.006,
  wood: 0.2,
  flesh: 0,
  glass: 0.03,
};

export function spawnProjectile(id: number, ownerId: number, team: number, origin: Vec3, dir: Vec3, spec: BulletSpec, inheritVel?: Vec3): Projectile {
  const v = spec.muzzleVelocity;
  return {
    id, ownerId, team,
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: {
      x: dir.x * v + (inheritVel?.x ?? 0),
      y: dir.y * v + (inheritVel?.y ?? 0),
      z: dir.z * v + (inheritVel?.z ?? 0),
    },
    age: 0, alive: true, energyScale: 1,
  };
}

export function damageAtSpeed(spec: BulletSpec, speed: number, energyScale: number): number {
  const e = (speed / spec.muzzleVelocity) ** 2 * energyScale;
  if (e < spec.minEnergyFraction) return 0;
  // Damage tracks energy but flattens (a 5.56/6.8 round is still lethal at 300 m).
  return spec.baseDamage * Math.min(1, 0.55 + 0.45 * e);
}

/**
 * Advances one projectile by dt, in sub-steps of at most `maxSubstep` seconds.
 * Pushes impacts into `out` (several if it penetrates). Returns false when it expires.
 */
export function stepProjectile(
  p: Projectile,
  spec: BulletSpec,
  dt: number,
  raycast: Raycast,
  out: ProjectileImpact[],
  gravity = 9.81,
  maxSubstep = 1 / 240,
): boolean {
  if (!p.alive) return false;
  let remaining = dt;
  while (remaining > 1e-9 && p.alive) {
    const h = Math.min(maxSubstep, remaining);
    remaining -= h;
    const speed0 = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    // Semi-implicit Euler with drag evaluated at start of the sub-step.
    const kd = spec.dragK * speed0;
    const nvx = p.vel.x - kd * p.vel.x * h;
    const nvy = p.vel.y - kd * p.vel.y * h - gravity * h;
    const nvz = p.vel.z - kd * p.vel.z * h;
    const dx = (p.vel.x + nvx) * 0.5 * h;
    const dy = (p.vel.y + nvy) * 0.5 * h;
    const dz = (p.vel.z + nvz) * 0.5 * h;
    const segLen = Math.hypot(dx, dy, dz);
    p.vel.x = nvx; p.vel.y = nvy; p.vel.z = nvz;
    p.age += h;
    if (segLen > 0) {
      const dir = { x: dx / segLen, y: dy / segLen, z: dz / segLen };
      const hit = raycast(p.pos, dir, segLen, p.ownerId);
      if (hit) {
        const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        const damage = damageAtSpeed(spec, speed, p.energyScale);
        const maxPen = PENETRATION_DEPTH[hit.material] * (speed / spec.muzzleVelocity) ** 2;
        const penetrated = hit.targetId === undefined && hit.thickness <= maxPen && hit.thickness > 0;
        out.push({ projectile: p, hit, damage, speed, penetrated });
        if (penetrated) {
          // Exit the far side with a velocity/energy penalty proportional to depth used.
          const used = hit.thickness / Math.max(maxPen, 1e-6);
          const vs = Math.sqrt(Math.max(0.05, 1 - 0.7 * used));
          p.vel.x *= vs; p.vel.y *= vs; p.vel.z *= vs;
          p.energyScale *= 1 - 0.5 * used;
          // Reappear just past the far face (hollow boxes: beyond the whole span, not inside).
          const exit = Math.max(hit.span ?? 0, hit.thickness) + 0.01;
          p.pos.x = hit.point.x + dir.x * exit;
          p.pos.y = hit.point.y + dir.y * exit;
          p.pos.z = hit.point.z + dir.z * exit;
          continue;
        }
        p.pos = { ...hit.point };
        p.alive = false;
        return false;
      }
      p.pos.x += dx; p.pos.y += dy; p.pos.z += dz;
    }
    if (p.age >= spec.maxLifetime || p.pos.y < -50) {
      p.alive = false;
      return false;
    }
  }
  return p.alive;
}

/**
 * Analytic-free helper used by tests/UI: simulate a round in open air and report drop and
 * time of flight at a given horizontal range.
 */
export function flightTo(spec: BulletSpec, range: number, gravity = 9.81, h = 1 / 2000): { time: number; drop: number; speed: number } {
  let x = 0, y = 0, vx = spec.muzzleVelocity, vy = 0, t = 0;
  while (x < range && t < spec.maxLifetime) {
    const sp = Math.hypot(vx, vy);
    vx -= spec.dragK * sp * vx * h;
    vy -= (spec.dragK * sp * vy + gravity) * h;
    x += vx * h; y += vy * h; t += h;
  }
  return { time: t, drop: -y, speed: Math.hypot(vx, vy) };
}
