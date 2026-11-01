/**
 * Plant/defuse objective + match result state machine (pure).
 * Attackers must plant a breaching charge on the site; defenders can defuse it during the fuse.
 * Detonation = attackers win. Clock expiry with no live charge = defenders win.
 * Reference: dynamite fuse 30 s, plant/defuse by engineers (docs/et-reference.md).
 */
export const OBJECTIVE = {
  plantSeconds: 3.5,
  defuseSeconds: 6,
  fuseSeconds: 30,
  interactRadius: 1.6,
  matchSeconds: 6 * 60,
} as const;

export type ChargeState = 'idle' | 'planting' | 'armed' | 'defusing' | 'detonated' | 'defused';
export type MatchPhase = 'playing' | 'attackersWin' | 'defendersWin';

export interface ObjectiveState {
  charge: ChargeState;
  progress: number; // seconds of hold for current plant/defuse
  fuse: number;
  clock: number;
  phase: MatchPhase;
  /** Combatant doing the current plant/defuse, -1 none. */
  actor: number;
  /** Defuse progress persists partially, like the reference (no full reset on interrupt). */
  defuseBanked: number;
}

export const createObjective = (): ObjectiveState => ({
  charge: 'idle', progress: 0, fuse: 0, clock: OBJECTIVE.matchSeconds, phase: 'playing', actor: -1, defuseBanked: 0,
});

export interface ObjectiveInput {
  /** Attacker ids currently holding interact inside the radius (alive). */
  attackersInteracting: readonly number[];
  defendersInteracting: readonly number[];
  /** Speed multiplier of the acting attacker / defender (class modifier); default 1. */
  attackerScale?: number;
  defenderScale?: number;
}

export type ObjectiveEvent = 'plantStarted' | 'planted' | 'defuseStarted' | 'defused' | 'detonated' | 'timeExpired' | null;

export function tickObjective(o: ObjectiveState, input: ObjectiveInput, dt: number): ObjectiveEvent {
  if (o.phase !== 'playing') return null;
  let ev: ObjectiveEvent = null;

  switch (o.charge) {
    case 'idle':
    case 'planting': {
      const a = input.attackersInteracting[0];
      if (a === undefined) { o.charge = 'idle'; o.progress = 0; o.actor = -1; break; }
      if (o.charge === 'idle') { o.charge = 'planting'; o.progress = 0; o.actor = a; ev = 'plantStarted'; }
      o.progress += dt * (input.attackerScale ?? 1);
      if (o.progress >= OBJECTIVE.plantSeconds) {
        o.charge = 'armed'; o.fuse = OBJECTIVE.fuseSeconds; o.progress = 0; o.actor = -1; o.defuseBanked = 0; ev = 'planted';
      }
      break;
    }
    case 'armed':
    case 'defusing': {
      o.fuse -= dt;
      const d = input.defendersInteracting[0];
      if (d === undefined) {
        if (o.charge === 'defusing') { o.defuseBanked = o.progress * 0.5; o.progress = 0; }
        o.charge = 'armed'; o.actor = -1;
      } else {
        if (o.charge === 'armed') { o.charge = 'defusing'; o.actor = d; o.progress = o.defuseBanked; ev = 'defuseStarted'; }
        o.progress += dt * (input.defenderScale ?? 1);
        if (o.progress >= OBJECTIVE.defuseSeconds) {
          o.charge = 'defused'; o.progress = 0; o.actor = -1; ev = 'defused';
          // A defused charge returns the site to idle so attackers can try again.
          o.charge = 'idle';
          return 'defused';
        }
      }
      if (o.fuse <= 0) { o.charge = 'detonated'; o.phase = 'attackersWin'; return 'detonated'; }
      break;
    }
    default:
      break;
  }

  // The clock keeps running; an armed charge must still resolve (overtime).
  o.clock = Math.max(0, o.clock - dt);
  if (o.clock <= 0 && (o.charge === 'idle' || o.charge === 'planting')) {
    o.phase = 'defendersWin';
    return 'timeExpired';
  }
  return ev;
}
