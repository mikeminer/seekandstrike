import './polyfill';
import { PublicKey } from '@solana/web3.js';
import { b64ToBytes, eqBytes, hexBytes, readU64 } from './bytes';
import { DAMM_POOL, DAMM_PROGRAM, DISC, FRIDGE_PROGRAM, NOMINAL_LAMPORTS, RECEIPT_WINDOW_S, PASS_MINT, TOKEN_2022_PROGRAM } from './constants';
import { ata } from './fridge';
import type { VerifiedLock } from './reader';
import { getOwnTransaction, type Rpc } from './rpc';
import { decodeTransaction } from './validator';

/**
 * Receipt rule (brief §9.5 (b)): a lock below the static floor still counts when it was bought
 * with ≥ 0.01 SOL in the pass pool (Meteora DAMM v2). This is the main proof now: the pass token amount depends on the
 * market, so only the receipt shows what was paid. Two accepted shapes:
 *  1. the lock's creating transaction itself contains the pool swap (amountIn ≥ N) and
 *     create_lock.amount == the swap's minimum_amount_out;
 *  2. (two-transaction / Activate) a successful swap by the same wallet within ±30 min of the
 *     lock's createdAt, amountIn ≥ N, whose pass token received ≥ the locked amount.
 */
interface TxResult {
  slot: number; blockTime: number | null;
  transaction: [string, 'base64'];
  meta: {
    err: unknown;
    preTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
  } | null;
}

async function getTx(rpc: Rpc, sig: string): Promise<TxResult | null> {
  return getOwnTransaction<TxResult>(rpc, sig);
}

function swapArgs(ixData: Uint8Array): { amountIn: bigint; minOut: bigint } | null {
  if (ixData.length !== 24 || !eqBytes(ixData.subarray(0, 8), hexBytes(DISC.dammSwap))) return null;
  return { amountIn: readU64(ixData, 8), minOut: readU64(ixData, 16) };
}

/** A swap instruction in the pass pool, paid and signed by `wallet` (payer is account 8, pool account 1). */
function isPoolSwap(ix: { programId: string; accounts: { key: string }[] }, wallet: string): boolean {
  return ix.programId === DAMM_PROGRAM && ix.accounts[1]?.key === DAMM_POOL && ix.accounts[8]?.key === wallet;
}

export function receiptFromCreatingTx(raw: Uint8Array, lock: VerifiedLock, wallet: string): boolean {
  let d;
  try { d = decodeTransaction(raw); } catch { return false; }
  if (d.keys[0] !== wallet || d.lookups !== 0) return false;
  let swap: { amountIn: bigint; minOut: bigint } | null = null;
  let lockAmount: bigint | null = null;
  for (const ix of d.ixs) {
    if (isPoolSwap(ix, wallet)) swap = swapArgs(ix.data) ?? swap;
    if (ix.programId === FRIDGE_PROGRAM && ix.data.length === 32 && eqBytes(ix.data.subarray(0, 8), hexBytes(DISC.createLock))
      && ix.accounts[3]?.key === lock.address) lockAmount = readU64(ix.data, 8);
  }
  return !!swap && lockAmount !== null && swap.amountIn >= NOMINAL_LAMPORTS && lockAmount === swap.minOut && lockAmount === lock.amount;
}

export async function verifyReceipt(rpc: Rpc, lock: VerifiedLock, wallet: string): Promise<boolean> {
  try {
    // 1. Creating transaction of the lock PDA (its oldest signature).
    const sigs = await rpc.call<{ signature: string; err: unknown; blockTime: number | null }[]>('getSignaturesForAddress', [
      lock.address, { limit: 10, commitment: 'confirmed' },
    ]);
    const okSigs = sigs.filter((s) => !s.err);
    const creating = okSigs[okSigs.length - 1];
    if (creating) {
      const tx = await getTx(rpc, creating.signature);
      if (tx && !tx.meta?.err && receiptFromCreatingTx(b64ToBytes(tx.transaction[0]), lock, wallet)) return true;
    }
    // 2. A separate swap within the window, on the wallet's pass-token account.
    const userAta = ata(new PublicKey(wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const ataSigs = await rpc.call<{ signature: string; err: unknown; blockTime: number | null }[]>('getSignaturesForAddress', [
      userAta, { limit: 20, commitment: 'confirmed' },
    ]);
    const created = Number(lock.createdAt);
    const near = ataSigs.filter((s) => !s.err && s.blockTime !== null && Math.abs(s.blockTime - created) <= RECEIPT_WINDOW_S);
    for (const s of near.slice(0, 5)) {
      const tx = await getTx(rpc, s.signature);
      if (!tx || tx.meta?.err || !tx.meta) continue;
      let d;
      try { d = decodeTransaction(b64ToBytes(tx.transaction[0])); } catch { continue; }
      if (d.keys[0] !== wallet) continue;
      const swap = d.ixs.map((ix) => (isPoolSwap(ix, wallet) ? swapArgs(ix.data) : null)).find(Boolean);
      if (!swap || swap.amountIn < NOMINAL_LAMPORTS) continue;
      const idx = d.keys.indexOf(userAta);
      const pre = BigInt(tx.meta.preTokenBalances?.find((b) => b.accountIndex === idx && b.mint === PASS_MINT)?.uiTokenAmount.amount ?? '0');
      const post = BigInt(tx.meta.postTokenBalances?.find((b) => b.accountIndex === idx && b.mint === PASS_MINT)?.uiTokenAmount.amount ?? '0');
      if (idx >= 0 && post - pre >= lock.amount) return true;
    }
  } catch {
    return false;
  }
  return false;
}
