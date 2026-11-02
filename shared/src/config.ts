/**
 * Single source of truth for product identity and owner-pending defaults.
 * Every value marked PENDING is a proposed default from docs/brief.md §12 that the
 * owner can change here without touching gameplay code.
 */

/** Game name (owner-confirmed 2026-10-28; change it ONLY here). */
export const GAME_TITLE = 'SEEK & STRIKE';
export const GAME_TITLE_IS_PROVISIONAL = false;
/** Owner-confirmed tagline (kept in English in every locale). */
export const GAME_TAGLINE = 'Every Seeker is a soldier.';
/**
 * Logo (owner-approved stencil set from art/logo, white variant for the dark menu), bundled
 * at public/assets/brand/logo.webp. Set to null to fall back to the text wordmark.
 */
export const GAME_LOGO_PATH: string | null = 'assets/brand/logo.webp';
/**
 * Wallet identity shown by Mobile Wallet Adapter when the Daily Pass is implemented.
 * No wallet code exists yet; this is identity metadata only.
 */
export const WALLET_IDENTITY = {
  name: GAME_TITLE,
  /** Owner-confirmed domain (2026-10-28), same as PENDING_DEFAULTS.domain. */
  uri: 'https://seekandstrike.it',
  /** Relative to uri; points to the pending logo art. */
  icon: 'assets/brand/icon-512.png',
} as const;

export interface PendingDefaults {
  /** PENDING: reverse-DNS Android application id (placeholder until owner confirms). */
  readonly androidAppId: string;
  /** PENDING: public domain for the online backend / store links. */
  readonly domain: string;
  /** PENDING: shipped locales; first entry is the fallback. */
  readonly locales: readonly ('it' | 'en')[];
  /** PENDING: gore level. 'low' = no blood, no dismemberment, hit markers only. */
  readonly gore: 'none' | 'low';
  /** Android host shell (owner default: Capacitor). */
  readonly androidHost: 'capacitor' | 'kotlin';
  /** PENDING: Daily Pass static floor, raw PASTA units (6 decimals → 100,000 PASTA). Below it the receipt rule decides, because the PASTA bought for 0.01 SOL follows the market. */
  readonly passFloorRaw: bigint;
  /** PENDING: swap slippage policy for the pass purchase (basis points). */
  readonly passSlippageBps: number;
  readonly passBufferSafetyBps: number;
  readonly passMaxBufferBps: number;
  /** PENDING: whether the client offers to close the expired lock and return rent. */
  readonly passOfferRentReturn: boolean;
}

export const PENDING_DEFAULTS: PendingDefaults = {
  androidAppId: 'it.seekandstrike.app',
  domain: 'seekandstrike.it',
  locales: ['it', 'en'],
  gore: 'low',
  androidHost: 'capacitor',
  passFloorRaw: 100_000_000_000n,
  passSlippageBps: 200,
  passBufferSafetyBps: 25,
  passMaxBufferBps: 600,
  passOfferRentReturn: true,
};

/**
 * Daily Pass RPC. The game first calls the project's own RPC proxy (server/, Cloudflare Worker:
 * method allowlist + rate limit, upstream URL kept as a Worker secret), then the public mainnet
 * endpoint. PENDING: proxyUrl stays null until the owner approves the Worker deploy + domain.
 */
export const PASS_RPC = {
  proxyUrl: null as string | null,
  publicFallback: 'https://api.mainnet-beta.solana.com',
} as const;

export function passRpcEndpoints(): string[] {
  return [PASS_RPC.proxyUrl, PASS_RPC.publicFallback].filter((u): u is string => !!u);
}

/**
 * Online play (authoritative MatchRoom, see docs/online.md). `wsUrl` is the Worker origin (ws:// or wss://, no path);
 * null hides the online button. The server refuses everyone until it can verify the Daily Pass itself.
 */
export const ONLINE = {
  wsUrl: null as string | null,
  defaultRoom: 'lobby-1',
  /** Quick match: rooms lobby-1..lobby-N are tried in order until one has a free seat. */
  quickMatchRooms: 8,
} as const;
