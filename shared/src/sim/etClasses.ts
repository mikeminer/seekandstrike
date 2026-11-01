/*
===========================================================================

Wolfenstein: Enemy Territory GPL Source Code
Copyright (C) 1999-2010 id Software LLC, a ZeniMax Media company.

This file is part of the Wolfenstein: Enemy Territory GPL Source Code (Wolf ET Source Code).

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
 * from src/game/bg_classes.c (class list, per-team class table, BG_GetPlayerClassInfo,
 * BG_ClassHasWeapon, BG_WeaponIsPrimaryForClassAndTeam, class names/letters, BG_ClassTextToClass,
 * BG_ClassSkillForClass). Changes: the 1940s weapon lists, character files and UI icon paths are
 * replaced by this game's own weapon ids (`WeaponId`) and no art paths; teams are
 * attackers/defenders (`Team`) instead of Axis/Allies; the "lieutenant" alias is kept; error
 * names carry no colour codes. This is NOT the original program.
 */
import type { Team } from './combatant';

/** Class ids, same order as the original PC_* values. */
export const PlayerClass = {
  Soldier: 0,
  Medic: 1,
  Engineer: 2,
  FieldOps: 3,
  CovertOps: 4,
} as const;
export type PlayerClass = (typeof PlayerClass)[keyof typeof PlayerClass];
export const NUM_PLAYER_CLASSES = 5;
export const MAX_WEAPS_PER_CLASS = 5;

/** Skill tracks of the original (only class-linked ones are returned by `classSkillForClass`). */
export type SkillType =
  | 'battleSense'
  | 'explosivesAndConstruction'
  | 'firstAid'
  | 'signals'
  | 'lightWeapons'
  | 'heavyWeapons'
  | 'militaryIntelligenceAndScopedWeapons';

/** Weapon ids available to the simulation; extend when more weapons exist (see weapons.ts). */
export type WeaponId = 'r30';

export interface PlayerClassInfo {
  classId: PlayerClass;
  /** Weapons this class may take as primary, in menu order (at most MAX_WEAPS_PER_CLASS). */
  classWeapons: readonly WeaponId[];
}

const RIFLE_ONLY: readonly WeaponId[] = ['r30'];

/**
 * Per-team class table. Both sides share the same loadouts for now because only one weapon
 * exists; the original lists differ per class and per side.
 */
function makeTeamClasses(): readonly PlayerClassInfo[] {
  return [
    { classId: PlayerClass.Soldier, classWeapons: RIFLE_ONLY },
    { classId: PlayerClass.Medic, classWeapons: RIFLE_ONLY },
    { classId: PlayerClass.Engineer, classWeapons: RIFLE_ONLY },
    { classId: PlayerClass.FieldOps, classWeapons: RIFLE_ONLY },
    { classId: PlayerClass.CovertOps, classWeapons: RIFLE_ONLY },
  ];
}

export const attackerClasses: readonly PlayerClassInfo[] = makeTeamClasses();
export const defenderClasses: readonly PlayerClassInfo[] = makeTeamClasses();

const teamClasses = (team: Team): readonly PlayerClassInfo[] => (team === 0 ? attackerClasses : defenderClasses);

/** BG_GetPlayerClassInfo: out-of-range classes fall back to Soldier. */
export function getPlayerClassInfo(team: Team, cls: number): PlayerClassInfo {
  if (!Number.isInteger(cls) || cls < PlayerClass.Soldier || cls >= NUM_PLAYER_CLASSES) cls = PlayerClass.Soldier;
  return teamClasses(team)[cls]!;
}

/** BG_ClassHasWeapon. */
export function classHasWeapon(info: PlayerClassInfo, weapon: WeaponId | null | undefined): boolean {
  if (!weapon) return false;
  return info.classWeapons.includes(weapon);
}

/** BG_WeaponIsPrimaryForClassAndTeam. */
export function weaponIsPrimaryForClassAndTeam(cls: number, team: Team, weapon: WeaponId): boolean {
  if (!Number.isInteger(cls) || cls < 0 || cls >= NUM_PLAYER_CLASSES) return false;
  return classHasWeapon(teamClasses(team)[cls]!, weapon);
}

const SHORT_NAMES = ['Soldr', 'Medic', 'Engr', 'FdOps', 'CvOps'] as const;
const NAMES = ['Soldier', 'Medic', 'Engineer', 'Field Ops', 'Covert Ops'] as const;
const LETTERS = ['S', 'M', 'E', 'F', 'C'] as const;

/** BG_ShortClassnameForNumber; unknown ids return 'ERROR'. */
export const shortClassName = (cls: number): string => SHORT_NAMES[cls as 0] ?? 'ERROR';
/** BG_ClassnameForNumber; unknown ids return 'ERROR'. */
export const className = (cls: number): string => NAMES[cls as 0] ?? 'ERROR';
/** BG_ClassLetterForNumber; unknown ids return 'E' like the original. */
export const classLetter = (cls: number): string => LETTERS[cls as 0] ?? 'E';

/** BG_ClassTextToClass: case-insensitive; returns -1 when unknown. */
export function classFromText(token: string): number {
  switch (token.toLowerCase()) {
    case 'soldier': return PlayerClass.Soldier;
    case 'medic': return PlayerClass.Medic;
    case 'lieutenant': // original alias for Field Ops
    case 'fieldops': return PlayerClass.FieldOps;
    case 'engineer': return PlayerClass.Engineer;
    case 'covertops': return PlayerClass.CovertOps;
    default: return -1;
  }
}

const CLASS_SKILLS: readonly SkillType[] = [
  'heavyWeapons',
  'firstAid',
  'explosivesAndConstruction',
  'signals',
  'militaryIntelligenceAndScopedWeapons',
];

/** BG_ClassSkillForClass: the skill track a class levels up; unknown classes use Battle Sense. */
export function classSkillForClass(cls: number): SkillType {
  if (!Number.isInteger(cls) || cls < 0 || cls >= NUM_PLAYER_CLASSES) return 'battleSense';
  return CLASS_SKILLS[cls]!;
}
