/**
 * DevFridge Scan sponsor feed (owner decision: one "sponsored token / YOUR AD HERE" card in the MAIN MENU only;
 * never in gameplay, the Daily Pass screens or checkout; never grants access). Rules follow
 * references/free-play-sponsors.md: fixed upstream, bounded time and size, no credentials/redirects, strict
 * mint/name/logo validation, links built locally, one stable pick per visit.
 */
export const SCAN_ORIGIN = 'https://scan.devfridge.cool';
export const FEED_URL = `${SCAN_ORIGIN}/api/feed/boosted`;
export const EMPTY_CARD_URL = `${SCAN_ORIGIN}/#feature`;
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 4_000;
const MAX_CANDIDATES = 256;
const MAX_SPONSORS = 12;

export interface Sponsor { mint: string; name: string; symbol: string; logo: string | null; url: string; expiresAt: number }

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** True when `s` is a base58 string that decodes to exactly 32 bytes. */
export function isMint(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  let lead = 0;
  while (lead < s.length && s[lead] === '1') lead++;
  let len = 0;
  while (n > 0n) { len++; n >>= 8n; }
  return lead + len === 32;
}

/** Bounded plain text: control characters and markup characters removed, trimmed, max `max` chars. */
export function plain(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, max);
}

/** Logos only from the exact Scan origin and /api/logo path (relative paths resolve against it). */
export function safeLogo(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048 || /[\s\u0000-\u001f\\#]/.test(v)) return null;
  try {
    const u = new URL(v, SCAN_ORIGIN);
    if (u.origin !== SCAN_ORIGIN || !u.pathname.startsWith('/api/logo') || u.username || u.password || u.hash) return null;
    return u.toString();
  } catch { return null; }
}

/** Validates a feed response; returns at most 12 unique, unexpired sponsors. Never throws. */
export function parseFeed(json: unknown, nowMs: number): Sponsor[] {
  const tokens = (json as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(tokens)) return [];
  const out: Sponsor[] = [];
  const seen = new Set<string>();
  for (const t of tokens.slice(0, MAX_CANDIDATES)) {
    if (out.length >= MAX_SPONSORS) break;
    const r = t as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') continue;
    const { mint, expiresAt } = r;
    if (!isMint(mint) || seen.has(mint)) continue;
    if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) continue;
    const name = plain(r.name, 32), symbol = plain(r.symbol, 12);
    if (!name || !symbol) continue;
    seen.add(mint);
    out.push({ mint, name, symbol, logo: safeLogo(r.image), url: `${SCAN_ORIGIN}/t/${mint}`, expiresAt });
  }
  return out;
}

/** Fetches the feed with a fixed URL, a timeout, no credentials, no redirects and a byte cap. Empty list on any failure. */
export async function fetchSponsors(nowMs: number = Date.now(), doFetch: typeof fetch = fetch): Promise<Sponsor[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(FEED_URL, { credentials: 'omit', redirect: 'error', signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return [];
    const text = await res.text();
    if (text.length > MAX_BYTES) return [];
    return parseFeed(JSON.parse(text), nowMs);
  } catch { return []; } finally { clearTimeout(timer); }
}

/** One stable pick per page visit: the first call decides, later calls return the same sponsor (or null) until it expires. */
let picked: { sponsor: Sponsor | null } | null = null;
export function pickOnce(list: Sponsor[], rand: () => number = Math.random): Sponsor | null {
  if (!picked) picked = { sponsor: list.length ? list[Math.min(list.length - 1, Math.floor(rand() * list.length))]! : null };
  return picked.sponsor;
}
/** Tests only. */
export function resetPick(): void { picked = null; }
