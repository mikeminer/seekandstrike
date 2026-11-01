/**
 * Health, downed (wounded) state and respawn waves (pure).
 * Reference: 100 HP; at 0 a player is wounded and can be revived or "taps out" to limbo,
 * then rejoins on the team's next reinforcement wave (docs/et-reference.md).
 */
export type LifeState = 'alive' | 'downed' | 'dead';

export const HEALTH = {
  max: 100,
  /** Seconds a downed soldier stays revivable before bleeding out. */
  bleedOutSeconds: 20,
  /** Additional damage to a downed body that finishes it (reference "gib" threshold, scaled). */
  finishDamage: 50,
  /** Health restored by a revive (reference: 50%). */
  reviveHealth: 50,
  /** Out-of-combat regeneration (stage-1 stand-in for medics), HP/s after delay. */
  regenDelay: 6,
  regenPerSecond: 4,
  regenCap: 60,
} as const;

export interface Health {
  hp: number;
  state: LifeState;
  downedTimer: number;
  /** Damage taken while downed. */
  downedDamage: number;
  sinceDamage: number;
  lastAttacker: number;
}

export const createHealth = (): Health => ({ hp: HEALTH.max, state: 'alive', downedTimer: 0, downedDamage: 0, sinceDamage: 99, lastAttacker: -1 });

export type DamageOutcome = 'none' | 'hurt' | 'downed' | 'killed';

export function applyDamage(h: Health, amount: number, attacker: number): DamageOutcome {
  if (amount <= 0 || h.state === 'dead') return 'none';
  h.sinceDamage = 0;
  h.lastAttacker = attacker;
  if (h.state === 'downed') {
    h.downedDamage += amount;
    if (h.downedDamage >= HEALTH.finishDamage) { h.state = 'dead'; return 'killed'; }
    return 'hurt';
  }
  h.hp -= amount;
  if (h.hp <= 0) {
    h.hp = 0;
    h.state = 'downed';
    h.downedTimer = HEALTH.bleedOutSeconds;
    h.downedDamage = 0;
    return 'downed';
  }
  return 'hurt';
}

export function tickHealth(h: Health, dt: number, regenScale = 1): void {
  h.sinceDamage += dt;
  if (h.state === 'downed') {
    h.downedTimer -= dt;
    if (h.downedTimer <= 0) h.state = 'dead';
  } else if (h.state === 'alive' && h.sinceDamage >= HEALTH.regenDelay && h.hp < (regenScale > 1 ? HEALTH.max : HEALTH.regenCap)) {
    h.hp = Math.min(regenScale > 1 ? HEALTH.max : HEALTH.regenCap, h.hp + HEALTH.regenPerSecond * regenScale * dt);
  }
}

export function tapOut(h: Health): void {
  if (h.state === 'downed') h.state = 'dead';
}

export function revive(h: Health): boolean {
  if (h.state !== 'downed') return false;
  h.state = 'alive';
  h.hp = HEALTH.reviveHealth;
  h.sinceDamage = 0;
  return true;
}

export function respawn(h: Health): void {
  h.hp = HEALTH.max;
  h.state = 'alive';
  h.downedTimer = 0;
  h.downedDamage = 0;
  h.sinceDamage = 99;
}

/** Team reinforcement clock: everyone dead respawns together when it reaches 0. */
export class WaveClock {
  private t: number;
  constructor(public readonly period: number, offset = 0) {
    this.t = period - (offset % period);
  }
  get secondsToWave(): number { return this.t; }
  /** Returns true on the tick a wave fires. */
  tick(dt: number): boolean {
    this.t -= dt;
    if (this.t <= 0) { this.t += this.period; return true; }
    return false;
  }
}
