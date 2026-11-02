import { DurableObject } from 'cloudflare:workers';
import { isoWeek, parseRound, rank, roundScore, shortWallet, type Row } from './book';

/**
 * One global Durable Object (SQLite storage) holding the weekly online leaderboard.
 *   POST /submit  {entries:[…]}  — from MatchRoom objects only (not routed from the public Worker)
 *   GET  /top?wallet=<addr>      — this week's top 50 and, when given, that wallet's own row
 */
export class Leaderboard extends DurableObject {
  private ready = false;

  private init(): void {
    if (this.ready) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      week TEXT NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0, kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (week, wallet))`);
    this.ready = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.init();
    const url = new URL(request.url);
    const week = isoWeek(new Date());
    if (request.method === 'POST' && url.pathname === '/submit') {
      const entries = parseRound(await request.json().catch(() => null));
      if (!entries) return new Response('bad round', { status: 400 });
      for (const e of entries) {
        this.ctx.storage.sql.exec(
          `INSERT INTO scores (week, wallet, name, score, kills, deaths, wins, rounds) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT (week, wallet) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END,
             score = score + excluded.score, kills = kills + excluded.kills, deaths = deaths + excluded.deaths,
             wins = wins + excluded.wins, rounds = rounds + 1`,
          week, e.wallet, e.name, roundScore(e), e.kills, e.deaths, e.won ? 1 : 0,
        );
      }
      return Response.json({ ok: true, counted: entries.length });
    }
    if (request.method === 'GET' && url.pathname === '/top') {
      const rows = this.ctx.storage.sql.exec(`SELECT * FROM scores WHERE week = ? ORDER BY score DESC LIMIT 500`, week).toArray() as unknown as Row[];
      const ranked = rank(rows);
      const wallet = url.searchParams.get('wallet');
      const me = wallet ? ranked.find((r) => r.wallet === wallet) ?? null : null;
      const pub = (r: (typeof ranked)[number]) => ({ rank: r.rank, name: r.name || shortWallet(r.wallet), wallet: shortWallet(r.wallet), score: r.score, kills: r.kills, deaths: r.deaths, wins: r.wins, rounds: r.rounds });
      return Response.json({ week, players: ranked.length, top: ranked.slice(0, 50).map(pub), me: me ? pub(me) : null }, { headers: { 'cache-control': 'no-store' } });
    }
    return new Response('Not found', { status: 404 });
  }
}
