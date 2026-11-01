export interface EvidenceLock { address: string; depositor: string; mint: string; amount: string; createdAt: number; unlockAt: number }
export interface Evidence { wallet: string; mint: string; ts: number; activeLocks: EvidenceLock[] }
export interface Tier { id: string; label: string; days: number; amountRaw: bigint }
export const DURATION_TOLERANCE_S: number;
export function prepareSeasonPassDeposits(evidence: Evidence, id: { wallet: string; mint: string }, nowSeconds: number): readonly Readonly<EvidenceLock>[];
export function tierForDeposit(deposit: Readonly<EvidenceLock>, tiers: Tier[], nowSeconds: number): Tier | null;
export function evaluateSeasonPass(deposits: readonly Readonly<EvidenceLock>[], tiers: Tier[], nowSeconds: number): {
  eligible: boolean; tier: Tier | null; expiresAt: number | null;
  qualifying: readonly { deposit: Readonly<EvidenceLock>; tier: Tier }[]; activeRaw: bigint;
};
