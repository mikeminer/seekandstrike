/**
 * Combatant hit volumes (pure): head sphere, torso capsule, legs capsule, posed by stance.
 * Used by the shared projectile raycast so client bots and a future server agree.
 */
import type { HitZone } from './ballistics';
import type { Stance } from './movement';
import { type Vec3, v3 } from './vec';

export interface Capsule { a: Vec3; b: Vec3; r: number; zone: HitZone }

export function hitVolumes(feet: Vec3, yaw: number, stance: Stance, downed: boolean): Capsule[] {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (downed) {
    // Downed: knocked onto the back along the facing axis, head BEHIND the feet origin
    // (matches the fall-backward downed/death animation of the rigged soldier).
    const p = (d: number, h: number): Vec3 => v3(feet.x + fx * d, feet.y + h, feet.z + fz * d);
    return [
      { a: p(-0.75, 0.2), b: p(-0.75, 0.2), r: 0.13, zone: 'head' },
      { a: p(-0.55, 0.2), b: p(-0.05, 0.2), r: 0.2, zone: 'torso' },
      { a: p(0.05, 0.15), b: p(0.85, 0.12), r: 0.16, zone: 'limb' },
    ];
  }
  if (stance === 'prone') {
    // Prone: lying face-down along the facing direction; head forward.
    const y = 0.22;
    const p = (d: number, h = y): Vec3 => v3(feet.x + fx * d, feet.y + h, feet.z + fz * d);
    return [
      { a: p(0.75, 0.25), b: p(0.75, 0.25), r: 0.13, zone: 'head' },
      { a: p(0.0), b: p(0.5), r: 0.2, zone: 'torso' },
      { a: p(-0.95, 0.15), b: p(-0.1, 0.18), r: 0.16, zone: 'limb' },
    ];
  }
  const k = stance === 'crouch' ? 0.66 : 1;
  const at = (h: number): Vec3 => v3(feet.x, feet.y + h, feet.z);
  return [
    { a: at(1.66 * k + (1 - k) * 0.25), b: at(1.66 * k + (1 - k) * 0.25), r: 0.12, zone: 'head' },
    { a: at(0.98 * k + (1 - k) * 0.2), b: at(1.42 * k + (1 - k) * 0.2), r: 0.21, zone: 'torso' },
    { a: at(0.12), b: at(0.88 * k), r: 0.17, zone: 'limb' },
  ];
}

/** Ray vs capsule; returns distance or -1. Direction must be normalised. */
export function rayCapsule(o: Vec3, d: Vec3, c: Capsule, maxDist: number): number {
  // Sample the capsule axis as spheres at sufficient density (cheap and robust for short capsules).
  const ax = c.b.x - c.a.x, ay = c.b.y - c.a.y, az = c.b.z - c.a.z;
  const len = Math.hypot(ax, ay, az);
  const n = Math.max(1, Math.ceil(len / (c.r * 0.5)));
  let best = -1;
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const t2 = raySphere(o, d, c.a.x + ax * t, c.a.y + ay * t, c.a.z + az * t, c.r);
    if (t2 >= 0 && t2 <= maxDist && (best < 0 || t2 < best)) best = t2;
  }
  return best;
}

function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : -1;
}
