import { evaluateSeasonPass, prepareSeasonPassDeposits, tierForDeposit, type Evidence } from './vendor/season-pass.mjs';
import { FLOOR_RAW, PASS_DAYS, PASS_MINT } from './constants';
import type { LockSnapshot, VerifiedLock } from './reader';

export const DAILY_TIER = { id: 'daily', label: 'Daily Pass', days: PASS_DAYS, amountRaw: FLOOR_RAW };
const RECEIPT_TIER = { id: 'daily-receipt', label: 'Daily Pass', days: PASS_DAYS, amountRaw: 1n };

export type PassStatus =
  | { state: 'active'; expiresAt: number; lock: VerifiedLock; via: 'floor' | 'receipt' }
  | { state: 'none'; partial: boolean; expired: VerifiedLock[]; pendingReceipt: VerifiedLock[] };

export function toEvidence(snap: LockSnapshot, wallet: string): Evidence {
  return {
    wallet, mint: PASS_MINT, ts: snap.ts,
    activeLocks: snap.locks.map((l) => ({
      address: l.address, depositor: l.depositor.toBase58(), mint: l.mint.toBase58(), amount: l.amount.toString(),
      createdAt: Number(l.createdAt), unlockAt: Number(l.unlockAt),
    })),
  };
}

/** Never earlier than any verified on-chain createdAt (protects against a slow device clock). */
export function trustedNow(snap: LockSnapshot, deviceNowS: number): number {
  let n = deviceNowS;
  for (const l of snap.locks) n = Math.max(n, Number(l.createdAt));
  return n;
}

/**
 * Brief §9.5: exactly one deposit counts (never summed); floor rule first through the vendored
 * Season Pass evaluator, then the receipt rule for deposits whose receipt was verified on chain.
 * Throws (fail closed) when the evidence is stale (> 90 s) or malformed.
 */
export function evaluatePass(snap: LockSnapshot, wallet: string, deviceNowS: number, receiptOk: ReadonlySet<string>): PassStatus {
  const now = trustedNow(snap, deviceNowS);
  const deposits = prepareSeasonPassDeposits(toEvidence(snap, wallet), { wallet, mint: PASS_MINT }, now);
  const byAddr = new Map(snap.locks.map((l) => [l.address, l] as const));
  const floor = evaluateSeasonPass(deposits, [DAILY_TIER], now);
  if (floor.eligible && floor.expiresAt !== null) {
    const best = floor.qualifying.reduce((a, b) => (b.deposit.unlockAt > a.deposit.unlockAt ? b : a));
    return { state: 'active', expiresAt: floor.expiresAt, lock: byAddr.get(best.deposit.address)!, via: 'floor' };
  }
  let best: { at: number; lock: VerifiedLock } | null = null;
  const pendingReceipt: VerifiedLock[] = [];
  for (const dep of deposits) {
    if (!tierForDeposit(dep, [RECEIPT_TIER], now)) continue;
    const lock = byAddr.get(dep.address)!;
    if (!receiptOk.has(dep.address)) { pendingReceipt.push(lock); continue; }
    if (!best || dep.unlockAt > best.at) best = { at: dep.unlockAt, lock };
  }
  if (best) return { state: 'active', expiresAt: best.at, lock: best.lock, via: 'receipt' };
  const expired = snap.locks.filter((l) => Number(l.unlockAt) <= now);
  return { state: 'none', partial: snap.partial, expired, pendingReceipt };
}
