/**
 * Gameplay modifiers per player class. Original values: the reference engine's class roles
 * (medic revives, engineer builds/defuses, covert ops are mobile, ...) are the inspiration, but
 * every class here carries the same single rifle until more weapons exist.
 */
import { PlayerClass } from './etClasses';

export interface ClassStats {
  /** Frag grenades carried at spawn. */
  grenades: number;
  /** Multiplier on plant and defuse speed. */
  plantScale: number;
  /** Multiplier on out-of-combat health regeneration (above 1 also lifts the regeneration cap to full health). */
  regenScale: number;
  /** May revive downed teammates. */
  canRevive: boolean;
  /** Multiplier on sprint stamina. */
  staminaScale: number;
  /** Hands out ammunition to nearby teammates (Field Ops). */
  canResupply: boolean;
}

export const CLASS_STATS: Record<PlayerClass, ClassStats> = {
  [PlayerClass.Soldier]: { grenades: 3, plantScale: 1, regenScale: 1, canRevive: false, staminaScale: 1, canResupply: false },
  [PlayerClass.Medic]: { grenades: 1, plantScale: 1, regenScale: 2.5, canRevive: true, staminaScale: 1, canResupply: false },
  [PlayerClass.Engineer]: { grenades: 2, plantScale: 1.6, regenScale: 1, canRevive: false, staminaScale: 1, canResupply: false },
  [PlayerClass.FieldOps]: { grenades: 4, plantScale: 1, regenScale: 1, canRevive: false, staminaScale: 1, canResupply: true },
  [PlayerClass.CovertOps]: { grenades: 1, plantScale: 1, regenScale: 1, canRevive: false, staminaScale: 1.5, canResupply: false },
};

export const classStats = (cls: number): ClassStats => CLASS_STATS[cls as PlayerClass] ?? CLASS_STATS[PlayerClass.Soldier];

/** Order bots cycle through, so each team gets every class. */
export const BOT_CLASS_ORDER: readonly PlayerClass[] = [
  PlayerClass.Soldier, PlayerClass.Medic, PlayerClass.Engineer, PlayerClass.FieldOps, PlayerClass.CovertOps,
];

/**
 * Field Ops ammunition (the reference class role): a living Field Ops hands one magazine to each teammate within
 * `radius` whose reserve is under `lowMagazines`, at most once per `cooldown` seconds per teammate; it refills its
 * own reserve the same way every `selfCooldown` seconds.
 */
export const RESUPPLY = { radius: 3.5, lowMagazines: 2, cooldown: 6, selfCooldown: 15 } as const;

export const REVIVE_SECONDS = 2.5;
export const REVIVE_RADIUS = 1.6;
