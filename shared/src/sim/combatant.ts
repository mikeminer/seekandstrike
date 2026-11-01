import { createHealth, type Health } from './health';
import { createMoveState, MOVE, type MoveState, type Stance } from './movement';
import { createWeapon, RIFLE_R30, type WeaponState } from './weapons';
import { type Vec3, v3 } from './vec';
import { PlayerClass } from './etClasses';
import { classStats } from './classStats';

export type Team = 0 | 1; // 0 = attackers (player side), 1 = defenders

export interface CombatInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jump: boolean;
  aim: boolean;
  fire: boolean;
  reload: boolean;
  interact: boolean;
  tapOut: boolean;
  /** Throw a frag grenade (edge-triggered: one throw per press). */
  throwGrenade: boolean;
  wantStance: Stance;
  /** Look deltas applied this step (rad). Bots set yaw/pitch directly instead. */
  lookYaw: number;
  lookPitch: number;
}

export const emptyInput = (): CombatInput => ({
  moveX: 0, moveY: 0, sprint: false, jump: false, aim: false, fire: false, reload: false,
  interact: false, tapOut: false, throwGrenade: false, wantStance: 'stand', lookYaw: 0, lookPitch: 0,
});

export interface Combatant {
  id: number;
  team: Team;
  isBot: boolean;
  callsign: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  /** Recoil offsets added on top of yaw/pitch; recover over time. */
  kickPitch: number;
  kickYaw: number;
  move: MoveState;
  weapon: WeaponState;
  health: Health;
  input: CombatInput;
  kills: number;
  deaths: number;
  /** Seconds since last shot (for audio/anim). */
  sinceShot: number;
  /** Horizontal speed (m/s) after collision, for animation. */
  speed: number;
  downedFor: number;
  cls: PlayerClass;
  grenades: number;
  grenadeCooldown: number;
  /** Previous value of input.throwGrenade, for edge detection. */
  prevThrow: boolean;
  /** Server only: how far behind the server the shooter's view was on the last command (s, already clamped). */
  lag: number;
}

export function createCombatant(id: number, team: Team, isBot: boolean, callsign: string, cls: PlayerClass = PlayerClass.Soldier): Combatant {
  return {
    id, team, isBot, callsign,
    pos: v3(), yaw: 0, pitch: 0, kickPitch: 0, kickYaw: 0,
    move: createMoveState(MOVE.staminaMax * classStats(cls).staminaScale),
    weapon: createWeapon(RIFLE_R30),
    health: createHealth(),
    input: emptyInput(),
    kills: 0, deaths: 0, sinceShot: 99, speed: 0, downedFor: 0,
    cls, grenades: classStats(cls).grenades, grenadeCooldown: 0, prevThrow: false, lag: 0,
  };
}

export const eyeHeight = (c: Combatant): number =>
  c.health.state === 'downed' ? 0.35 : MOVE.eye[c.move.stance];

export const eyePos = (c: Combatant): Vec3 => v3(c.pos.x, c.pos.y + eyeHeight(c), c.pos.z);
export const chestPos = (c: Combatant): Vec3 =>
  v3(c.pos.x, c.pos.y + (c.health.state === 'downed' || c.move.stance === 'prone' ? 0.25 : c.move.stance === 'crouch' ? 0.85 : 1.25), c.pos.z);
