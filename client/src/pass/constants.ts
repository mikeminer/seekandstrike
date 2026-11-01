import { PENDING_DEFAULTS } from '@shared/config';

/**
 * Daily Pass on-chain constants. Every address here was verified read-only on mainnet on
 * 2026-10-28 (docs/brief.md §9.2) and is re-checked at runtime before any wallet request.
 */
export const CLUSTER = 'mainnet-beta' as const;
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

// Programs
export const FRIDGE_PROGRAM = '9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const JUPITER_V6_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

// Mints
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const PASTA_MINT = '39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump';
/** The token the Daily Pass locks (Token-2022). Bought in the same transaction from the Meteora DAMM v2 pool below. */
export const PASS_MINT = PASTA_MINT;
export const PASS_DECIMALS = 6;
export const PASS_SYMBOL = 'PASTA';

// Meteora DAMM v2 (cp-amm) pool PASTA/wSOL, owner-chosen 2026-10-29. Re-read from chain at every quote; any mismatch fails closed.
export const DAMM_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
export const DAMM_POOL = '9RTD1Es749sYfaz4gNQGd9iQi2ougzRcvmzzYvEqskXN';
/** Pool authority, fixed in the program (IDL `swap` account address). */
export const DAMM_POOL_AUTHORITY = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';

// Discriminators (hex)
export const DISC = {
  createLock: 'abd85ca7a508995a',
  claim: '3ec6d6c1d59f6cd2',
  lockAccount: '08ff24cad2163989',
  /** cp-amm `swap` (IDL cp_amm 0.2.5). */
  dammSwap: 'f8c69e91e17587c8',
  /** cp-amm Pool account. */
  dammPool: 'f19a6d0411b16dbc',
} as const;

export const LOCK_ACCOUNT_SIZE = 105;
export const MAX_LOCK_ID = 64;

// Owner policy (docs/brief.md §9.1 / §9.5 / §9.5-bis).
export const PASS_DAYS = 1;
export const PASS_SECONDS = 86_400;
export const DURATION_TOLERANCE_S = 3_600;
/** Nominal purchase N: 0.01 SOL. */
export const NOMINAL_LAMPORTS = 10_000_000n;
export const FLOOR_RAW = PENDING_DEFAULTS.passFloorRaw;
export const DEFAULT_SLIPPAGE_BPS = PENDING_DEFAULTS.passSlippageBps;
export const SLIPPAGE_OPTIONS_BPS = [100, 200, 500] as const;
export const MAX_BUFFER_BPS = PENDING_DEFAULTS.passMaxBufferBps;
/** Extra slippage per retry after a slippage failure. */
export const SLIPPAGE_RETRY_STEP_BPS = 25;
/** Receipt search window around the lock's createdAt (two-transaction / Activate case). */
export const RECEIPT_WINDOW_S = 30 * 60;
export const EVIDENCE_MAX_AGE_S = 90;
export const QUOTE_REFRESH_MS = 5_000;
export const RPC_TIMEOUT_MS = 6_000;
export const COMPUTE_UNIT_LIMIT = 300_000;
export const COMPUTE_UNIT_LIMIT_LOCK_ONLY = 60_000;
export const MAX_COMPUTE_UNITS = 400_000;
/** Priority fee ceiling (micro-lamports per CU) the app will ever propose. */
export const MAX_PRIORITY_MICROLAMPORTS = 200_000;
export const TX_SIZE_LIMIT = 1232;
/** Reserve kept in the wallet beyond the exact simulated cost (future network fees). */
export const SOL_FEE_RESERVE_LAMPORTS = 100_000n;
/** Pending reconciliation window for a stale awaiting-wallet record. */
export const PENDING_RECONCILE_MS = 10 * 60_000;

// Redeem (rent return + token release at expiry, Fridge `claim`).
export const CLAIM_FEE_BPS = 200n;
export const JUPITER_API = 'https://lite-api.jup.ag/swap/v1';
export const CLAIM_SLIPPAGE_BPS = 300;
