import { afterEach, describe, expect, it } from 'vitest';
import { fetchSponsors, isMint, parseFeed, pickOnce, plain, resetPick, safeLogo, SCAN_ORIGIN } from './feed';

const MINT = '82cE5gmmJ9hH2F1o1CtDrQbaUaR6ZW4mtRZVNHCJpump';
const MINT2 = '39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump';
const NOW = 1_800_000_000_000;
const tok = (o: Record<string, unknown> = {}) => ({ mint: MINT, name: 'Swangy', symbol: 'SWANGY', image: '/api/logo?m=x', expiresAt: NOW + 60_000, ...o });

afterEach(() => resetPick());

describe('mint and text validation', () => {
  it('accepts real mints only', () => {
    expect(isMint(MINT)).toBe(true);
    expect(isMint('So11111111111111111111111111111111111111112')).toBe(true);
    for (const bad of ['', 'abc', MINT + 'x', '0'.repeat(44), 'O' + MINT.slice(1), 42, null]) expect(isMint(bad)).toBe(false);
  });
  it('plain strips markup and controls and bounds length', () => {
    expect(plain('<img src=x onerror=1>Hi\u0000"there"', 32)).toBe('img src=x onerror=1Hithere');
    expect(plain('x'.repeat(100), 10)).toHaveLength(10);
    expect(plain(5, 10)).toBe('');
  });
  it('logos only from the Scan origin and /api/logo', () => {
    expect(safeLogo('/api/logo?m=abc')).toBe(`${SCAN_ORIGIN}/api/logo?m=abc`);
    expect(safeLogo(`${SCAN_ORIGIN}/api/logo/x.png`)).toContain('/api/logo/');
    for (const bad of ['https://evil.example/api/logo', `${SCAN_ORIGIN}/other.png`, 'javascript:alert(1)', `${SCAN_ORIGIN}/api/logo#frag`, 'https://user:pw@scan.devfridge.cool/api/logo', '/api/logo\\x', `${SCAN_ORIGIN}/api/logo ${'a'.repeat(2100)}`, null]) {
      expect(safeLogo(bad)).toBeNull();
    }
  });
});

describe('parseFeed', () => {
  it('keeps valid unexpired sponsors and builds the link locally', () => {
    const [s] = parseFeed({ tokens: [tok({ url: 'https://evil.example' })] }, NOW);
    expect(s!.url).toBe(`${SCAN_ORIGIN}/t/${MINT}`);
    expect(s!.logo).toBe(`${SCAN_ORIGIN}/api/logo?m=x`);
  });
  it('drops expired, duplicate, malformed and non-array feeds', () => {
    const list = parseFeed({ tokens: [tok({ expiresAt: NOW - 1 }), tok(), tok(), tok({ mint: 'bad' }), tok({ mint: MINT2, expiresAt: 'x' }), tok({ mint: MINT2, name: '<>' }), null, 7] }, NOW);
    expect(list.map((s) => s.mint)).toEqual([MINT]);
    expect(parseFeed({ tokens: 'no' }, NOW)).toEqual([]);
    expect(parseFeed(null, NOW)).toEqual([]);
  });
  it('limits to 12 sponsors out of at most 256 candidates', () => {
    const many = Array.from({ length: 300 }, (_, i) => tok({ mint: MINT.slice(0, 40) + String(1000 + i).slice(0, 4) }));
    expect(parseFeed({ tokens: many }, NOW).length).toBeLessThanOrEqual(12);
  });
});

describe('fetchSponsors', () => {
  const res = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  it('returns the parsed list and sends no credentials', async () => {
    let seen: RequestInit | undefined;
    const list = await fetchSponsors(NOW, (async (_u: unknown, i?: RequestInit) => { seen = i; return res(JSON.stringify({ tokens: [tok()] })); }) as typeof fetch);
    expect(list).toHaveLength(1);
    expect(seen?.credentials).toBe('omit');
    expect(seen?.redirect).toBe('error');
  });
  it('returns an empty list on errors, wrong type, oversize and bad JSON', async () => {
    const f = (r: () => Response | Promise<Response>) => fetchSponsors(NOW, (async () => r()) as typeof fetch);
    expect(await f(() => res('{}', { status: 500 }))).toEqual([]);
    expect(await f(() => res('{}', { headers: { 'content-type': 'text/html' } }))).toEqual([]);
    expect(await f(() => res(JSON.stringify({ tokens: [], pad: 'x'.repeat(200_000) })))).toEqual([]);
    expect(await f(() => res('not json'))).toEqual([]);
    expect(await f(() => { throw new Error('offline'); })).toEqual([]);
  });
});

describe('pickOnce', () => {
  it('keeps the first choice for the whole visit', () => {
    const a = parseFeed({ tokens: [tok(), tok({ mint: MINT2 })] }, NOW);
    const first = pickOnce(a, () => 0.99);
    expect(first!.mint).toBe(MINT2);
    expect(pickOnce(a, () => 0)).toBe(first);
    resetPick();
    expect(pickOnce([], () => 0)).toBeNull();
  });
});
