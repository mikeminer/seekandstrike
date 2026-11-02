/**
 * Player progression (pure, no DOM): XP and levels, unlocks, daily/weekly challenges, lifetime stats.
 * The profile lives on the device (see profileStore.ts); nothing here touches the chain or the Daily Pass.
 * Rewards are cosmetic only (rifle finish, red-dot colour, rank title): no gameplay advantage.
 */

/** What one match produced for the local player (built by MatchTracker from sim events). */
export interface MatchReport {
  won: boolean;
  completed: boolean;
  kills: number;
  headshots: number;
  adsKills: number;
  grenadeKills: number;
  deaths: number;
  plants: number;
  defuses: number;
  revives: number;
  shots: number;
  hits: number;
  bestStreak: number;
  seconds: number;
}

export const emptyReport = (): MatchReport => ({
  won: false, completed: false, kills: 0, headshots: 0, adsKills: 0, grenadeKills: 0, deaths: 0, plants: 0, defuses: 0,
  revives: 0, shots: 0, hits: 0, bestStreak: 0, seconds: 0,
});

export const XP = { kill: 100, headshot: 50, grenadeKill: 50, plant: 250, defuse: 250, revive: 75, win: 300, completed: 100, perMinute: 20 } as const;
export const MAX_LEVEL = 50;

/** XP needed to go from `level` to `level + 1`. */
export const xpForLevel = (level: number): number => 500 + 150 * (level - 1);

export function levelFromXp(totalXp: number): { level: number; into: number; need: number } {
  let level = 1, left = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && left >= xpForLevel(level)) { left -= xpForLevel(level); level++; }
  return { level, into: left, need: level >= MAX_LEVEL ? 0 : xpForLevel(level) };
}

export interface XpLine { key: 'kills' | 'headshots' | 'grenadeKills' | 'plants' | 'defuses' | 'revives' | 'win' | 'completed' | 'time' | 'challenges'; xp: number; count?: number }

export function matchXp(r: MatchReport): XpLine[] {
  const out: XpLine[] = [];
  const add = (key: XpLine['key'], count: number, each: number): void => { if (count > 0) out.push({ key, count, xp: count * each }); };
  add('kills', r.kills, XP.kill);
  add('headshots', r.headshots, XP.headshot);
  add('grenadeKills', r.grenadeKills, XP.grenadeKill);
  add('plants', r.plants, XP.plant);
  add('defuses', r.defuses, XP.defuse);
  add('revives', r.revives, XP.revive);
  if (r.won) out.push({ key: 'win', xp: XP.win });
  if (r.completed) out.push({ key: 'completed', xp: XP.completed });
  const minutes = Math.floor(r.seconds / 60);
  if (minutes > 0) out.push({ key: 'time', count: minutes, xp: minutes * XP.perMinute });
  return out;
}

/** Rank titles by level band. */
/** Index of the rank title (0..10) for a level; the title text is the meta string `rank.<i>`. */
export const rankIndex = (level: number): number => (level >= MAX_LEVEL ? 10 : Math.min(9, Math.floor((level - 1) / 5)));
export const RANKS_IT = ['Recluta', 'Soldato', 'Caporale', 'Caporalmaggiore', 'Sergente', 'Sergente maggiore', 'Maresciallo', 'Sottotenente', 'Tenente', 'Capitano', 'Maggiore'] as const;
export const RANKS_EN = ['Recruit', 'Private', 'Corporal', 'Lance Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer', 'Second Lieutenant', 'Lieutenant', 'Captain', 'Major'] as const;
export const rankFor = (level: number, lang: 'it' | 'en' = 'it'): string => (lang === 'it' ? RANKS_IT : RANKS_EN)[level >= MAX_LEVEL ? RANKS_IT.length - 1 : Math.min(RANKS_IT.length - 2, Math.floor((level - 1) / 5))]!;

/** Cosmetic unlocks. `tint` multiplies the rifle albedo; `dot` is the red-dot colour. */
export interface Unlock { id: string; level: number; kind: 'finish' | 'dot'; nameIt: string; nameEn: string; tint?: number; dot?: number }
export const UNLOCKS: readonly Unlock[] = [
  { id: 'finish.std', level: 1, kind: 'finish', nameIt: 'Standard', nameEn: 'Standard', tint: 0xffffff },
  { id: 'dot.red', level: 1, kind: 'dot', nameIt: 'Punto rosso', nameEn: 'Red dot', dot: 0xff3020 },
  { id: 'finish.sand', level: 3, kind: 'finish', nameIt: 'Sabbia', nameEn: 'Sand', tint: 0xd8c39a },
  { id: 'dot.green', level: 5, kind: 'dot', nameIt: 'Punto verde', nameEn: 'Green dot', dot: 0x38ff5a },
  { id: 'finish.olive', level: 7, kind: 'finish', nameIt: 'Oliva', nameEn: 'Olive', tint: 0x9aa47a },
  { id: 'finish.slate', level: 10, kind: 'finish', nameIt: 'Ardesia', nameEn: 'Slate', tint: 0x8e9aa8 },
  { id: 'dot.amber', level: 12, kind: 'dot', nameIt: 'Punto ambra', nameEn: 'Amber dot', dot: 0xffb020 },
  { id: 'finish.night', level: 15, kind: 'finish', nameIt: 'Notte', nameEn: 'Night', tint: 0x5a5f6a },
  { id: 'dot.cyan', level: 20, kind: 'dot', nameIt: 'Punto ciano', nameEn: 'Cyan dot', dot: 0x30e0ff },
  { id: 'finish.bronze', level: 25, kind: 'finish', nameIt: 'Bronzo', nameEn: 'Bronze', tint: 0xc8925a },
  { id: 'finish.gold', level: 40, kind: 'finish', nameIt: 'Oro opaco', nameEn: 'Matte gold', tint: 0xe6c060 },
];
export const unlockedAt = (level: number): Unlock[] => UNLOCKS.filter((u) => u.level <= level);
export const newUnlocks = (fromLevel: number, toLevel: number): Unlock[] => UNLOCKS.filter((u) => u.level > fromLevel && u.level <= toLevel);

/** Challenges. `stat` is a MatchReport field summed over matches ('matches' and 'wins' count matches). */
export type ChallengeStat = 'kills' | 'headshots' | 'adsKills' | 'grenadeKills' | 'plants' | 'defuses' | 'revives' | 'wins' | 'matches';
export interface ChallengeDef { id: string; stat: ChallengeStat; goal: number; xp: number }
export const DAILY_POOL: readonly ChallengeDef[] = [
  { id: 'd.kills8', stat: 'kills', goal: 8, xp: 300 },
  { id: 'd.kills15', stat: 'kills', goal: 15, xp: 450 },
  { id: 'd.head3', stat: 'headshots', goal: 3, xp: 350 },
  { id: 'd.ads5', stat: 'adsKills', goal: 5, xp: 300 },
  { id: 'd.gren2', stat: 'grenadeKills', goal: 2, xp: 350 },
  { id: 'd.plant1', stat: 'plants', goal: 1, xp: 300 },
  { id: 'd.win1', stat: 'wins', goal: 1, xp: 350 },
  { id: 'd.matches3', stat: 'matches', goal: 3, xp: 300 },
  { id: 'd.revive2', stat: 'revives', goal: 2, xp: 300 },
];
export const WEEKLY_POOL: readonly ChallengeDef[] = [
  { id: 'w.kills60', stat: 'kills', goal: 60, xp: 1500 },
  { id: 'w.head20', stat: 'headshots', goal: 20, xp: 1500 },
  { id: 'w.win5', stat: 'wins', goal: 5, xp: 1500 },
  { id: 'w.plant5', stat: 'plants', goal: 5, xp: 1200 },
  { id: 'w.gren10', stat: 'grenadeKills', goal: 10, xp: 1200 },
  { id: 'w.matches12', stat: 'matches', goal: 12, xp: 1200 },
  { id: 'w.ads30', stat: 'adsKills', goal: 30, xp: 1300 },
];

/** UTC day key (YYYY-MM-DD) and ISO-week key (YYYY-Www). */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic pick of `n` distinct challenges for a period key (same for every player on that day/week). */
export function pickChallenges(pool: readonly ChallengeDef[], key: string, n: number): ChallengeDef[] {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, n).map((i) => pool[i]!);
}

export interface ChallengeProgress { id: string; progress: number; done: boolean }
export interface ChallengeSet { key: string; items: ChallengeProgress[] }

export interface Stats {
  matches: number; wins: number; kills: number; deaths: number; headshots: number; adsKills: number; grenadeKills: number;
  plants: number; defuses: number; revives: number; shots: number; hits: number; bestStreak: number; seconds: number;
}
export const emptyStats = (): Stats => ({
  matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, adsKills: 0, grenadeKills: 0, plants: 0, defuses: 0, revives: 0,
  shots: 0, hits: 0, bestStreak: 0, seconds: 0,
});

export interface Settings {
  lookSens: number; // 0.5..2 multiplier
  aimSens: number; // 0.5..2 multiplier on the aimed scale
  aimAssist: boolean;
  /** Name shown online and in the leaderboard (letters, digits, space _ . -, 1-16). */
  callsign: string;
  /** Team voice in online matches (push-to-talk) and its volume. */
  voiceOn: boolean;
  voiceVolume: number;
  volume: number; // 0..1
  difficulty: 'recruit' | 'regular' | 'veteran';
  finish: string;
  dot: string;
}
export const defaultSettings = (): Settings => ({ lookSens: 1, aimSens: 1, aimAssist: true, callsign: '', voiceOn: true, voiceVolume: 0.9, volume: 0.8, difficulty: 'regular', finish: 'finish.std', dot: 'dot.red' });

export interface Profile {
  v: 1;
  xp: number;
  stats: Stats;
  daily: ChallengeSet;
  weekly: ChallengeSet;
  tutorialDone: boolean;
  /** Day key of the last free match used without a Daily Pass. */
  freeDay: string;
  settings: Settings;
}

export function newProfile(now: Date): Profile {
  return { v: 1, xp: 0, stats: emptyStats(), daily: freshSet(DAILY_POOL, dayKey(now), 3), weekly: freshSet(WEEKLY_POOL, weekKey(now), 3), tutorialDone: false, freeDay: '', settings: defaultSettings() };
}

const freshSet = (pool: readonly ChallengeDef[], key: string, n: number): ChallengeSet => ({ key, items: pickChallenges(pool, key, n).map((c) => ({ id: c.id, progress: 0, done: false })) });

/** Rolls daily/weekly challenges over when the period changed. */
export function refreshPeriods(p: Profile, now: Date): void {
  if (p.daily.key !== dayKey(now)) p.daily = freshSet(DAILY_POOL, dayKey(now), 3);
  if (p.weekly.key !== weekKey(now)) p.weekly = freshSet(WEEKLY_POOL, weekKey(now), 3);
}

export const challengeDef = (id: string): ChallengeDef | undefined => [...DAILY_POOL, ...WEEKLY_POOL].find((c) => c.id === id);

const statOf = (r: MatchReport, s: ChallengeStat): number => (s === 'matches' ? (r.completed ? 1 : 0) : s === 'wins' ? (r.won ? 1 : 0) : r[s]);

export interface MatchResult {
  lines: XpLine[];
  xpGained: number;
  before: { level: number; into: number; need: number };
  after: { level: number; into: number; need: number };
  completedChallenges: ChallengeDef[];
  unlocked: Unlock[];
}

/** Applies a finished match to the profile (mutates it) and returns what to show on the summary screen. */
export function applyMatch(p: Profile, r: MatchReport, now: Date): MatchResult {
  refreshPeriods(p, now);
  const before = levelFromXp(p.xp);
  const lines = matchXp(r);
  const completedChallenges: ChallengeDef[] = [];
  for (const set of [p.daily, p.weekly]) {
    for (const it of set.items) {
      if (it.done) continue;
      const def = challengeDef(it.id);
      if (!def) continue;
      it.progress = Math.min(def.goal, it.progress + statOf(r, def.stat));
      if (it.progress >= def.goal) { it.done = true; completedChallenges.push(def); }
    }
  }
  const chXp = completedChallenges.reduce((s, c) => s + c.xp, 0);
  if (chXp > 0) lines.push({ key: 'challenges', count: completedChallenges.length, xp: chXp });
  const xpGained = lines.reduce((s, l) => s + l.xp, 0);
  p.xp += xpGained;
  const s = p.stats;
  if (r.completed) s.matches++;
  if (r.won) s.wins++;
  s.kills += r.kills; s.deaths += r.deaths; s.headshots += r.headshots; s.adsKills += r.adsKills; s.grenadeKills += r.grenadeKills;
  s.plants += r.plants; s.defuses += r.defuses; s.revives += r.revives; s.shots += r.shots; s.hits += r.hits; s.seconds += r.seconds;
  s.bestStreak = Math.max(s.bestStreak, r.bestStreak);
  const after = levelFromXp(p.xp);
  return { lines, xpGained, before, after, completedChallenges, unlocked: newUnlocks(before.level, after.level) };
}

/** Defensive parse of a stored profile: unknown/old data falls back to defaults field by field. */
export function parseProfile(raw: unknown, now: Date): Profile {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<Profile>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const p: Profile = {
    ...base,
    xp: num(o.xp, 0),
    tutorialDone: o.tutorialDone === true,
    freeDay: typeof o.freeDay === 'string' ? o.freeDay : '',
  };
  if (o.stats && typeof o.stats === 'object') for (const k of Object.keys(base.stats) as (keyof Stats)[]) p.stats[k] = num((o.stats as Stats)[k], 0);
  const set = (v: unknown, d: ChallengeSet): ChallengeSet => {
    const s = v as ChallengeSet | undefined;
    if (!s || typeof s.key !== 'string' || !Array.isArray(s.items)) return d;
    const items = s.items.filter((i) => i && typeof i.id === 'string' && challengeDef(i.id)).map((i) => ({ id: i.id, progress: num(i.progress, 0), done: i.done === true }));
    return items.length ? { key: s.key, items } : d;
  };
  p.daily = set(o.daily, base.daily);
  p.weekly = set(o.weekly, base.weekly);
  const st = (o.settings ?? {}) as Partial<Settings>;
  const clampN = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  p.settings = {
    lookSens: clampN(st.lookSens, 0.5, 2, 1),
    aimSens: clampN(st.aimSens, 0.5, 2, 1),
    aimAssist: st.aimAssist !== false,
    voiceOn: st.voiceOn !== false,
    voiceVolume: clampN(st.voiceVolume, 0, 1, 0.9),
    callsign: typeof st.callsign === 'string' ? st.callsign.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) : '',
    volume: clampN(st.volume, 0, 1, 0.8),
    difficulty: st.difficulty === 'recruit' || st.difficulty === 'veteran' ? st.difficulty : 'regular',
    finish: typeof st.finish === 'string' && UNLOCKS.some((u) => u.id === st.finish && u.kind === 'finish') ? st.finish : 'finish.std',
    dot: typeof st.dot === 'string' && UNLOCKS.some((u) => u.id === st.dot && u.kind === 'dot') ? st.dot : 'dot.red',
  };
  refreshPeriods(p, now);
  return p;
}
