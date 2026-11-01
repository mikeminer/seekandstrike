import { describe, expect, it } from 'vitest';
import { accelerate, applyFriction, clipVelocity, cmdScale, ET_PM, stepSprintTime } from './etMove';
import {
  classFromText, classHasWeapon, className, classLetter, classSkillForClass, getPlayerClassInfo,
  NUM_PLAYER_CLASSES, PlayerClass, shortClassName, weaponIsPrimaryForClassAndTeam,
} from './etClasses';

describe('etMove (port of bg_pmove.c)', () => {
  it('clipVelocity removes the component into the surface (with overclip)', () => {
    const out = clipVelocity({ x: 3, y: -4, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(out.x).toBe(3);
    expect(out.y).toBeCloseTo(-4 + 4 * ET_PM.overclip, 6);
    expect(out.y).toBeGreaterThan(0); // pushed slightly off the surface
    const away = clipVelocity({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(away.y).toBeCloseTo(2 - 2 / ET_PM.overclip, 6);
  });
  it('friction: slow movement drops by the stop-speed rule, fast movement decays proportionally', () => {
    const v = { x: 0.5, y: 0, z: 0 };
    applyFriction(v, 6, 1.2, 1 / 60);
    expect(v.x).toBeCloseTo(0.5 - (1.2 * 6) / 60, 6);
    const fast = { x: 10, y: 0, z: 0 };
    applyFriction(fast, 6, 1.2, 1 / 60);
    expect(fast.x).toBeCloseTo(10 * (1 - 6 / 60), 6);
    const rest = { x: 0.01, y: 0, z: 0.01 };
    applyFriction(rest, 6, 1.2, 1 / 60);
    expect(rest).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('accelerate never exceeds wishSpeed along wishdir', () => {
    const v = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 600; i++) accelerate(v, { x: 1, y: 0, z: 0 }, 4, 10, 1 / 60);
    expect(v.x).toBeCloseTo(4, 6);
    const before = { ...v };
    accelerate(v, { x: 1, y: 0, z: 0 }, 4, 10, 1 / 60);
    expect(v).toEqual(before);
  });
  it('cmdScale removes the diagonal sqrt(2) bonus', () => {
    // scaled command length is speed * max / 127, whatever the direction
    expect(cmdScale(127, 0, 0, 100) * 127).toBeCloseTo(100, 6);
    expect(cmdScale(127, 127, 0, 100) * Math.hypot(127, 127)).toBeCloseTo(100, 6);
    expect(cmdScale(64, 64, 0, 100) * Math.hypot(64, 64)).toBeCloseTo((100 * 64) / 127, 6);
    expect(cmdScale(0, 0, 0, 100)).toBe(0);
  });
  it('sprint timer drains 5000/s, recharges 500/s and doubles above 5000', () => {
    expect(stepSprintTime(20000, 1, { exerting: true })).toBe(15000);
    expect(stepSprintTime(0, 10, { exerting: true })).toBe(0);
    expect(stepSprintTime(0, 1, { exerting: false })).toBeCloseTo(500, 6);
    expect(stepSprintTime(6000, 1, { exerting: false })).toBeCloseTo(7000, 6);
    expect(stepSprintTime(19900, 1, { exerting: false })).toBe(ET_PM.sprintTime);
    expect(stepSprintTime(0, 1, { exerting: false, battleSense: true })).toBeCloseTo(800, 6);
  });
});

describe('etClasses (port of bg_classes.c)', () => {
  it('falls back to Soldier for out-of-range classes', () => {
    expect(getPlayerClassInfo(0, 99).classId).toBe(PlayerClass.Soldier);
    expect(getPlayerClassInfo(1, -1).classId).toBe(PlayerClass.Soldier);
    expect(getPlayerClassInfo(1, PlayerClass.Medic).classId).toBe(PlayerClass.Medic);
  });
  it('knows which weapons a class has', () => {
    const info = getPlayerClassInfo(0, PlayerClass.Engineer);
    expect(classHasWeapon(info, 'r30')).toBe(true);
    expect(classHasWeapon(info, null)).toBe(false);
    expect(weaponIsPrimaryForClassAndTeam(PlayerClass.Soldier, 1, 'r30')).toBe(true);
    expect(weaponIsPrimaryForClassAndTeam(NUM_PLAYER_CLASSES, 1, 'r30')).toBe(false);
  });
  it('names, letters and text lookup', () => {
    expect(className(PlayerClass.FieldOps)).toBe('Field Ops');
    expect(shortClassName(PlayerClass.CovertOps)).toBe('CvOps');
    expect(classLetter(PlayerClass.Medic)).toBe('M');
    expect(className(42)).toBe('ERROR');
    expect(classFromText('Lieutenant')).toBe(PlayerClass.FieldOps);
    expect(classFromText('COVERTOPS')).toBe(PlayerClass.CovertOps);
    expect(classFromText('pilot')).toBe(-1);
  });
  it('maps classes to their skill track', () => {
    expect(classSkillForClass(PlayerClass.Medic)).toBe('firstAid');
    expect(classSkillForClass(PlayerClass.CovertOps)).toBe('militaryIntelligenceAndScopedWeapons');
    expect(classSkillForClass(-3)).toBe('battleSense');
  });
});
