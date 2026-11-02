import { describe, expect, it } from 'vitest';
import { applyRound, cleanName, isoWeek, parseRound, rank, roundScore, shortWallet, type Row } from './book';
import { mapIdForRoom, roomMap, ONLINE_MAP_IDS } from '../room/map';

const W1 = '97g84xDhkSL1uQxVsdVpK7Y76Lt18H92TbZfERgZYbDD';
const W2 = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

describe('weekly leaderboard', () => {
  it('scores rounds on the server formula and accumulates per wallet', () => {
    const rows = new Map<string, Row>();
    applyRound(rows, '2026-W45', [{ wallet: W1, name: 'Mike', kills: 4, deaths: 2, won: true, map: 'banchina-est' }]);
    applyRound(rows, '2026-W45', [{ wallet: W1, name: '', kills: 1, deaths: 3, won: false, map: 'scalo-ferroviario' }, { wallet: W2, name: 'Bot?', kills: 9, deaths: 0, won: true, map: 'x' }]);
    const r1 = rows.get(W1)!;
    expect(r1).toMatchObject({ name: 'Mike', kills: 5, deaths: 5, wins: 1, rounds: 2, score: roundScore({ kills: 4, won: true }) + roundScore({ kills: 1, won: false }) });
    const board = rank(rows.values());
    expect(board[0]!.wallet).toBe(W2);
    expect(board.map((b) => b.rank)).toEqual([1, 2]);
  });
  it('ties share a rank', () => {
    const rows = new Map<string, Row>();
    applyRound(rows, 'w', [{ wallet: W1, name: 'a', kills: 2, deaths: 0, won: false, map: '' }, { wallet: W2, name: 'b', kills: 2, deaths: 0, won: false, map: '' }]);
    expect(rank(rows.values()).map((r) => r.rank)).toEqual([1, 1]);
  });
  it('rejects bad payloads and sanitises names', () => {
    expect(parseRound(null)).toBeNull();
    expect(parseRound({ entries: [{ wallet: 'not-a-wallet', kills: 1, deaths: 1 }, { wallet: W1, kills: -1, deaths: 0 }, { wallet: W1, kills: 1e9, deaths: 0 }] })).toEqual([]);
    expect(parseRound({ entries: [{ wallet: W1, name: '<b>Mike</b>!!', kills: 3, deaths: 1, won: true }] })![0]!.name).toBe('bMikeb');
    expect(cleanName('a'.repeat(40))).toHaveLength(16);
    expect(shortWallet(W1)).toBe('97g8…YbDD');
  });
  it('ISO weeks', () => {
    expect(isoWeek(new Date('2026-11-02T10:00:00Z'))).toBe('2026-W45');
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});

describe('online maps', () => {
  it('a room name picks its map; anything else plays Banchina Est', () => {
    expect(mapIdForRoom('magazzini-sale-3')).toBe('magazzini-sale');
    expect(mapIdForRoom('porto-vecchio-1')).toBe('porto-vecchio');
    expect(mapIdForRoom('lobby-1')).toBe('banchina-est');
    expect(mapIdForRoom('scalo-ferroviario-8')).toBe('scalo-ferroviario');
  });
  it('every online map builds with spawns, an objective and a nav grid', () => {
    for (const id of ONLINE_MAP_IDS) {
      const m = roomMap(id);
      expect(m.id).toBe(id);
      expect(m.spawns[0].length).toBeGreaterThan(0);
      expect(m.navGrid).toBeDefined();
    }
  });
});
