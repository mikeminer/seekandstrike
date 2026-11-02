import { describe, expect, it } from 'vitest';
import {
  DAILY_POOL, MAX_LEVEL, UNLOCKS, WEEKLY_POOL, XP, applyMatch, dayKey, emptyReport, levelFromXp, matchXp, newProfile, parseProfile,
  pickChallenges, rankFor, weekKey, xpForLevel,
} from './progression';
import { MatchTracker } from './tracker';
import type { SimEvent } from '@shared/sim/match';

const NOW = new Date('2026-11-02T10:00:00Z');

describe('levels', () => {
  it('level curve is monotonic and capped', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, need: xpForLevel(1) });
    expect(levelFromXp(xpForLevel(1)).level).toBe(2);
    expect(levelFromXp(1e9).level).toBe(MAX_LEVEL);
    let prev = 0;
    for (let x = 0; x < 200000; x += 997) { const l = levelFromXp(x).level; expect(l).toBeGreaterThanOrEqual(prev); prev = l; }
  });
  it('ranks have Italian and English names', () => {
    expect(rankFor(1, 'it')).toBe('Recluta');
    expect(rankFor(1, 'en')).toBe('Recruit');
    expect(rankFor(50, 'en')).toBe('Major');
  });
  it('every unlock is reachable', () => { for (const u of UNLOCKS) expect(u.level).toBeLessThanOrEqual(MAX_LEVEL); });
});

describe('match XP', () => {
  it('counts every action once', () => {
    const r = { ...emptyReport(), kills: 3, headshots: 1, plants: 1, won: true, completed: true, seconds: 185 };
    const total = matchXp(r).reduce((s, l) => s + l.xp, 0);
    expect(total).toBe(3 * XP.kill + XP.headshot + XP.plant + XP.win + XP.completed + 3 * XP.perMinute);
  });
});

describe('challenges', () => {
  it('daily and weekly picks are deterministic, distinct and change with the period', () => {
    const a = pickChallenges(DAILY_POOL, '2026-11-02', 3), b = pickChallenges(DAILY_POOL, '2026-11-02', 3);
    expect(a).toEqual(b);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    const days = new Set(Array.from({ length: 10 }, (_, i) => pickChallenges(DAILY_POOL, `2026-11-${10 + i}`, 3).map((c) => c.id).join()));
    expect(days.size).toBeGreaterThan(3);
    expect(pickChallenges(WEEKLY_POOL, weekKey(NOW), 3)).toHaveLength(3);
  });
  it('week key follows ISO weeks', () => {
    expect(weekKey(new Date('2026-11-02T00:00:00Z'))).toBe('2026-W45');
    expect(weekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    expect(dayKey(NOW)).toBe('2026-11-02');
  });
  it('a match advances challenges, completes them once and pays their XP', () => {
    const p = newProfile(NOW);
    p.daily.items = [{ id: 'd.kills8', progress: 6, done: false }];
    p.weekly.items = [{ id: 'w.win5', progress: 0, done: false }];
    const res = applyMatch(p, { ...emptyReport(), kills: 4, won: true, completed: true, seconds: 30 }, NOW);
    expect(p.daily.items[0]).toEqual({ id: 'd.kills8', progress: 8, done: true });
    expect(p.weekly.items[0]!.progress).toBe(1);
    expect(res.completedChallenges.map((c) => c.id)).toEqual(['d.kills8']);
    expect(res.lines.find((l) => l.key === 'challenges')!.xp).toBe(300);
    const again = applyMatch(p, { ...emptyReport(), kills: 4, completed: true }, NOW);
    expect(again.completedChallenges).toHaveLength(0);
  });
  it('periods roll over', () => {
    const p = newProfile(NOW);
    p.daily.items[0]!.progress = 5;
    applyMatch(p, emptyReport(), new Date('2026-11-03T10:00:00Z'));
    expect(p.daily.key).toBe('2026-11-03');
  });
});

describe('profile storage parsing', () => {
  it('survives garbage and keeps valid fields', () => {
    expect(parseProfile('nope', NOW).xp).toBe(0);
    const p = parseProfile({ xp: 1234, stats: { kills: 7, deaths: -3 }, settings: { lookSens: 9, difficulty: 'veteran', finish: 'finish.gold' }, tutorialDone: true }, NOW);
    expect(p.xp).toBe(1234);
    expect(p.stats.kills).toBe(7);
    expect(p.stats.deaths).toBe(0);
    expect(p.settings.lookSens).toBe(2);
    expect(p.settings.difficulty).toBe('veteran');
    expect(p.settings.finish).toBe('finish.gold');
    expect(p.tutorialDone).toBe(true);
  });
  it('level-up reports newly unlocked cosmetics', () => {
    const p = newProfile(NOW);
    p.xp = levelFromXp(0).need - 10; // just below level 2
    const res = applyMatch(p, { ...emptyReport(), kills: 30, completed: true }, NOW);
    expect(res.after.level).toBeGreaterThan(res.before.level);
    expect(res.unlocked.every((u) => u.level > res.before.level && u.level <= res.after.level)).toBe(true);
  });
});

describe('match tracker', () => {
  it('turns sim events into the report and score popups', () => {
    const tr = new MatchTracker(0, 0);
    const ev: SimEvent[] = [
      { type: 'shot', shooter: 0, origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, projectile: 1 },
      { type: 'damage', attacker: 0, victim: 5, amount: 40, zone: 'torso', outcome: 'hurt' },
      { type: 'damage', attacker: 0, victim: 5, amount: 90, zone: 'head', outcome: 'downed' },
      { type: 'damage', attacker: 0, victim: 6, amount: 120, zone: 'blast', outcome: 'downed' },
      { type: 'objective', event: 'planted', by: 0 },
      { type: 'damage', attacker: 7, victim: 0, amount: 120, zone: 'torso', outcome: 'downed' },
      { type: 'matchEnd', winner: 0 },
    ];
    const pops = tr.onEvents(ev, 1);
    const r = tr.report;
    expect([r.shots, r.hits, r.kills, r.headshots, r.grenadeKills, r.adsKills, r.plants, r.deaths, r.bestStreak]).toEqual([1, 3, 2, 1, 1, 1, 1, 1, 2]);
    expect(r.won && r.completed).toBe(true);
    expect(pops.map((p) => p.label)).toEqual(['hit', 'headshot', 'grenade', 'plant']);
  });
});
