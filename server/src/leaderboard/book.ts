/**
 * Weekly online leaderboard (pure: no Cloudflare APIs, unit-tested). Rows are keyed by ISO week and wallet; the
 * score is computed by the SERVER from the authoritative round, never sent by a client:
 *   score = takedowns × 100 + wins × 300 + rounds played × 50
 * Only seats holding a verified Daily Pass wallet are counted.
 */
export interface RoundEntry { wallet: string; name: string; kills: number; deaths: number; won: boolean; map: string }
export interface Row { week: string; wallet: string; name: string; score: number; kills: number; deaths: number; wins: number; rounds: number }
export interface Ranked extends Omit<Row, 'week'> { rank: number }

export const SCORE = { kill: 100, win: 300, round: 50 } as const;
export const roundScore = (e: Pick<RoundEntry, 'kills' | 'won'>): number => e.kills * SCORE.kill + (e.won ? SCORE.win : 0) + SCORE.round;

/** ISO-8601 week key, UTC (e.g. 2026-W45). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Display names: letters, digits, space, _ . - only, 1-16 chars (anything else is dropped). */
export const cleanName = (s: unknown): string => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) : '');

/** Validates a round batch posted by a room (defence in depth: rooms are ours, but the payload is still checked). */
export function parseRound(body: unknown): RoundEntry[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { entries?: unknown }).entries)) return null;
  const out: RoundEntry[] = [];
  for (const raw of (body as { entries: unknown[] }).entries.slice(0, 16)) {
    const e = raw as Partial<RoundEntry>;
    if (typeof e.wallet !== 'string' || !WALLET_RE.test(e.wallet)) continue;
    const kills = Number(e.kills), deaths = Number(e.deaths);
    if (!Number.isInteger(kills) || kills < 0 || kills > 200 || !Number.isInteger(deaths) || deaths < 0 || deaths > 200) continue;
    out.push({ wallet: e.wallet, name: cleanName(e.name), kills, deaths, won: e.won === true, map: typeof e.map === 'string' ? e.map.slice(0, 32) : '' });
  }
  return out;
}

/** Adds a round to the week's rows (returns the updated rows of the affected wallets). */
export function applyRound(rows: Map<string, Row>, week: string, entries: RoundEntry[]): Row[] {
  const touched: Row[] = [];
  for (const e of entries) {
    const r = rows.get(e.wallet) ?? { week, wallet: e.wallet, name: e.name, score: 0, kills: 0, deaths: 0, wins: 0, rounds: 0 };
    if (e.name) r.name = e.name;
    r.score += roundScore(e);
    r.kills += e.kills;
    r.deaths += e.deaths;
    r.wins += e.won ? 1 : 0;
    r.rounds += 1;
    rows.set(e.wallet, r);
    touched.push(r);
  }
  return touched;
}

/** Standard competition ranking (1, 2, 2, 4) by score, then fewer rounds, then wallet for a stable order. */
export function rank(rows: Iterable<Row>): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.rounds - b.rounds || a.wallet.localeCompare(b.wallet));
  const out: Ranked[] = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    const rankN = prev && prev.score === r.score ? prev.rank : i + 1;
    const { week: _w, ...rest } = r;
    out.push({ ...rest, rank: rankN });
  });
  return out;
}

/** Public form of a wallet in the board (never the full address). */
export const shortWallet = (w: string): string => `${w.slice(0, 4)}…${w.slice(-4)}`;
