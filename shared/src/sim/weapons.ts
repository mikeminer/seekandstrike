/**
 * Weapon state machine (pure): fire rate, magazine + chamber, tactical/empty reloads,
 * recoil impulses and dispersion. The host turns `fire()` results into projectiles.
 */
import { type BulletSpec, type HitZone } from './ballistics';
import { type Rng } from './rng';
import type { Stance } from './movement';

export type WeaponKind = 'rifle' | 'sniper' | 'launcher';

export interface WeaponSpec {
  id: string;
  /** rifle: automatic carbine · sniper: bolt-action with a magnified scope · launcher: fires rockets (no bullet). */
  kind: WeaponKind;
  /** World field of view (deg) when fully aimed; rifles use the default ADS zoom. */
  adsFov?: number;
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
  kind: 'rifle',
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

/** 'SR-7 Falco', fictional bolt-action marksman rifle (Covert Ops primary). One shot to the head is a takedown. */
export const SNIPER_SR7: WeaponSpec = {
  id: 'sr7',
  kind: 'sniper',
  adsFov: 16,
  name: 'SR-7 Falco',
  calibre: '8.6×70 mm',
  roundsPerMinute: 50, // bolt cycle 1.2 s
  magazine: 5,
  reserveMagazines: 4,
  reloadTacticalSeconds: 3.0,
  reloadEmptySeconds: 3.6,
  adsSeconds: 0.32,
  bullet: { muzzleVelocity: 960, dragK: 4.5e-4, maxLifetime: 3, baseDamage: 92, minEnergyFraction: 0.2 },
  recoilPitch: 0.055,
  recoilPitchJitter: 0.006,
  recoilYaw: 0.004,
  recoilRecovery: 0.22,
  spreadHip: 0.075,
  spreadAds: 0.0002,
  spreadMovingAdd: 0.06,
  spreadPerShot: 0,
  spreadMax: 0.12,
  spreadRecovery: 0.2,
  zoneMultiplier: { head: 3, torso: 1.1, limb: 0.7 },
};

/** 'LR-1 Martello', fictional shoulder-fired rocket launcher (Soldier secondary). Fires a rocket (see grenade.ts ROCKET). */
export const LAUNCHER_LR1: WeaponSpec = {
  id: 'lr1',
  kind: 'launcher',
  name: 'LR-1 Martello',
  calibre: '84 mm',
  roundsPerMinute: 30,
  magazine: 1,
  reserveMagazines: 3,
  reloadTacticalSeconds: 2.8,
  reloadEmptySeconds: 2.8,
  adsSeconds: 0.3,
  bullet: { muzzleVelocity: 1, dragK: 0, maxLifetime: 0.01, baseDamage: 0, minEnergyFraction: 1 }, // unused: rockets are not bullets
  recoilPitch: 0.06,
  recoilPitchJitter: 0.01,
  recoilYaw: 0.01,
  recoilRecovery: 0.2,
  spreadHip: 0.03,
  spreadAds: 0.004,
  spreadMovingAdd: 0.03,
  spreadPerShot: 0,
  spreadMax: 0.06,
  spreadRecovery: 0.1,
  zoneMultiplier: { head: 1, torso: 1, limb: 1 },
};

export const WEAPONS: Record<string, WeaponSpec> = { r30: RIFLE_R30, sr7: SNIPER_SR7, lr1: LAUNCHER_LR1 };
export const weaponById = (id: string | undefined): WeaponSpec => (id && WEAPONS[id]) || RIFLE_R30;

/** Seconds to put one weapon away and raise the other. */
export const SWITCH_SECONDS = 0.45;

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

/**
 * Moves the aim-down-sights blend towards `target` by at most `step` and HOLDS it there. The ONE place this is
 * computed (offline sim and the online mirror): `target > ads ? up : down` lowered a fully aimed weapon every other
 * step, and the sight jumped between two poses (fixed offline on 2026-11-02, then found again in the online mirror).
 */
export function approachAds(ads: number, target: number, step: number): number {
  if (target > ads) return Math.min(target, ads + step);
  if (target < ads) return Math.max(target, ads - step);
  return ads;
}

/** Advance timers; `aim` drives the ADS blend. Completes reloads. */
export function tickWeapon(w: WeaponState, dt: number, aim: boolean): void {
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  const adsTarget = aim && w.phase === 'ready' ? 1 : 0;
  const rate = dt / w.spec.adsSeconds;
  // Move towards the target and HOLD it once reached. (The old `target > ads ? up : down` lowered a fully aimed
  // weapon every other tick: ads flickered 1 ↔ 0.924 and the sight jumped between two poses.)
  w.ads = approachAds(w.ads, adsTarget, rate);
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
