/**
 * Weapon state machine (pure): fire rate, magazine + chamber, tactical/empty reloads,
 * recoil impulses and dispersion. The host turns `fire()` results into projectiles.
 */
import { type BulletSpec, type HitZone } from './ballistics';
import { type Rng } from './rng';
import type { Stance } from './movement';

export interface WeaponSpec {
  id: string;
  /** Display name key (fictional 2030 rifle, no real-world trademarks). */
  name: string;
  calibre: string;
  roundsPerMinute: number;
  magazine: number;
  reserveMagazines: number;
  reloadTacticalSeconds: number;
  reloadEmptySeconds: number;
  adsSeconds: number;
  bullet: BulletSpec;
  /** Vertical kick per shot (rad) and its random spread, plus horizontal wander (rad). */
  recoilPitch: number;
  recoilPitchJitter: number;
  recoilYaw: number;
  /** View recoil recovery (rad/s). */
  recoilRecovery: number;
  /** Cone half-angles (rad). */
  spreadHip: number;
  spreadAds: number;
  spreadMovingAdd: number;
  spreadPerShot: number;
  spreadMax: number;
  spreadRecovery: number;
  zoneMultiplier: Record<HitZone, number>;
}

/** 'R-30 Vettore', fictional 6.8 mm bullpup-less carbine of 2030 (generic, no real brand). */
export const RIFLE_R30: WeaponSpec = {
  id: 'r30',
  name: 'R-30 Vettore',
  calibre: '6.8×51 mm',
  roundsPerMinute: 720,
  magazine: 30,
  reserveMagazines: 4,
  reloadTacticalSeconds: 2.3,
  reloadEmptySeconds: 2.9,
  adsSeconds: 0.22,
  bullet: {
    muzzleVelocity: 905,
    // rho 1.225 * Cd ~0.30 * A 3.8e-5 m^2 / (2 * 8.8 g)
    dragK: 7.9e-4,
    maxLifetime: 2.5,
    baseDamage: 36,
    minEnergyFraction: 0.08,
  },
  recoilPitch: 0.0135,
  recoilPitchJitter: 0.004,
  recoilYaw: 0.006,
  recoilRecovery: 0.16,
  spreadHip: 0.03,
  spreadAds: 0.0012,
  spreadMovingAdd: 0.025,
  spreadPerShot: 0.0035,
  spreadMax: 0.07,
  spreadRecovery: 0.06,
  zoneMultiplier: { head: 3, torso: 1, limb: 0.7 },
};

export type WeaponPhase = 'ready' | 'reloading';

export interface WeaponState {
  spec: WeaponSpec;
  inMag: number;
  chambered: boolean;
  reserve: number;
  phase: WeaponPhase;
  reloadTimer: number;
  reloadTotal: number;
  cooldown: number;
  /** Accumulated bloom from sustained fire (rad). */
  bloom: number;
  /** 0 = hip, 1 = fully aimed (eases over adsSeconds). */
  ads: number;
  shotsFired: number;
}

export const createWeapon = (spec: WeaponSpec): WeaponState => ({
  spec,
  inMag: spec.magazine - 1,
  chambered: true,
  reserve: spec.magazine * spec.reserveMagazines,
  phase: 'ready',
  reloadTimer: 0,
  reloadTotal: 0,
  cooldown: 0,
  bloom: 0,
  ads: 0,
  shotsFired: 0,
});

export const roundsLoaded = (w: WeaponState): number => w.inMag + (w.chambered ? 1 : 0);

export interface ShotContext {
  stance: Stance;
  moving: number; // 0..1 normalised horizontal speed
  airborne: boolean;
}

export interface Shot {
  /** Angular offsets (rad) to apply to the aim direction for this round. */
  spreadYaw: number;
  spreadPitch: number;
  /** View kick to add to the shooter's camera. */
  kickPitch: number;
  kickYaw: number;
}

const STANCE_STABILITY: Record<Stance, number> = { stand: 1, crouch: 0.8, prone: 0.55 };

export function currentSpread(w: WeaponState, ctx: ShotContext): number {
  const s = w.spec;
  const base = s.spreadHip + (s.spreadAds - s.spreadHip) * w.ads;
  const moving = s.spreadMovingAdd * ctx.moving * (1 - 0.6 * w.ads) + (ctx.airborne ? s.spreadMovingAdd * 2 : 0);
  return Math.min(s.spreadMax, (base + moving + w.bloom) * STANCE_STABILITY[ctx.stance]);
}

/** Advance timers; `aim` drives the ADS blend. Completes reloads. */
export function tickWeapon(w: WeaponState, dt: number, aim: boolean): void {
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  const adsTarget = aim && w.phase === 'ready' ? 1 : 0;
  const rate = dt / w.spec.adsSeconds;
  w.ads = adsTarget > w.ads ? Math.min(1, w.ads + rate) : Math.max(0, w.ads - rate);
  w.bloom = Math.max(0, w.bloom - w.spec.spreadRecovery * dt);
  if (w.phase === 'reloading') {
    w.reloadTimer -= dt;
    if (w.reloadTimer <= 0) finishReload(w);
  }
}

export function canReload(w: WeaponState): boolean {
  return w.phase === 'ready' && w.reserve > 0 && w.inMag < w.spec.magazine;
}

export function startReload(w: WeaponState): boolean {
  if (!canReload(w)) return false;
  w.phase = 'reloading';
  w.reloadTotal = w.chambered ? w.spec.reloadTacticalSeconds : w.spec.reloadEmptySeconds;
  w.reloadTimer = w.reloadTotal;
  return true;
}

function finishReload(w: WeaponState): void {
  // The partially used magazine is retained (realistic magazine-based reserve would drop it;
  // we keep a simple round pool for stage 1).
  const need = w.spec.magazine - w.inMag;
  const take = Math.min(need, w.reserve);
  w.inMag += take;
  w.reserve -= take;
  if (!w.chambered && w.inMag > 0) { w.inMag -= 1; w.chambered = true; }
  w.phase = 'ready';
  w.reloadTimer = 0;
}

/** Attempts one shot. Returns null when the weapon cannot fire this tick. */
export function tryFire(w: WeaponState, ctx: ShotContext, rng: Rng): Shot | null {
  if (w.phase !== 'ready' || w.cooldown > 0 || !w.chambered) return null;
  const s = w.spec;
  const spread = currentSpread(w, ctx);
  // Uniform disc sample in the cone.
  const r = Math.sqrt(rng.next()) * spread;
  const a = rng.next() * Math.PI * 2;
  const recoilScale = STANCE_STABILITY[ctx.stance] * (1 - 0.3 * w.ads);
  const shot: Shot = {
    spreadYaw: Math.cos(a) * r,
    spreadPitch: Math.sin(a) * r,
    kickPitch: (s.recoilPitch + rng.gauss() * s.recoilPitchJitter) * recoilScale,
    kickYaw: rng.gauss() * s.recoilYaw * recoilScale,
  };
  w.chambered = false;
  if (w.inMag > 0) { w.inMag -= 1; w.chambered = true; }
  w.cooldown = 60 / s.roundsPerMinute;
  w.bloom = Math.min(s.spreadMax, w.bloom + s.spreadPerShot);
  w.shotsFired += 1;
  return shot;
}
