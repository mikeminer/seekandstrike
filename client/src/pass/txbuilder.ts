import './polyfill';
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import {
  COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_LIMIT_LOCK_ONLY, PASS_MINT, TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM, TX_SIZE_LIMIT, WSOL_MINT,
} from './constants';
import { ata, createLockIx } from './fridge';
import { dammSwapIx, type DammRoute } from './meteora';
import { closeAccountIx, createAtaIdempotentIx, setCuLimitIx, setCuPriceIx, syncNativeIx, transferLamportsIx } from './tokenIx';

export type TxKind = 'single' | 'swap' | 'lock';

/** Everything the player reviewed, plus the fresh build parameters. Validated before the wallet. */
export interface PurchaseIntent {
  wallet: string;
  /** The pass pool; not needed for a lock-only transaction. */
  route?: DammRoute;
  /**
   * The player already has a wrapped-SOL account: it is used as is and NOT closed, so wrapped SOL
   * they already hold is never unwrapped behind their back. Otherwise a temporary one is opened and closed.
   */
  wsolExists?: boolean;
  amountIn: bigint;
  minOut: bigint;
  target: bigint;
  lockId: bigint;
  unlockAt: bigint;
  cuPrice: number;
  blockhash: string;
}

export function swapInstructions(user: PublicKey, route: DammRoute, amountIn: bigint, minOut: bigint, wsolExists = false): TransactionInstruction[] {
  const wsol = new PublicKey(WSOL_MINT);
  const pass = new PublicKey(PASS_MINT);
  const wsolAta = ata(user, wsol, TOKEN_PROGRAM);
  return [
    ...(wsolExists ? [] : [createAtaIdempotentIx(user, user, wsol, TOKEN_PROGRAM)]),
    transferLamportsIx(user, wsolAta, amountIn),
    syncNativeIx(wsolAta, TOKEN_PROGRAM),
    createAtaIdempotentIx(user, user, pass, TOKEN_2022_PROGRAM),
    dammSwapIx(user, route, amountIn, minOut),
    ...(wsolExists ? [] : [closeAccountIx(wsolAta, user, user, TOKEN_PROGRAM)]),
  ];
}

export function lockInstruction(user: PublicKey, amount: bigint, unlockAt: bigint, lockId: bigint) {
  return createLockIx({ depositor: user, mint: new PublicKey(PASS_MINT), amount, unlockAt, lockId });
}

function requireRoute(r: DammRoute | undefined): DammRoute {
  if (!r) throw new Error('swap needs the pass pool route');
  return r;
}

export function instructionsFor(kind: TxKind, it: PurchaseIntent): TransactionInstruction[] {
  const user = new PublicKey(it.wallet);
  const budget = [setCuLimitIx(kind === 'lock' ? COMPUTE_UNIT_LIMIT_LOCK_ONLY : COMPUTE_UNIT_LIMIT), ...(it.cuPrice > 0 ? [setCuPriceIx(it.cuPrice)] : [])];
  const swap = kind === 'lock' ? [] : swapInstructions(user, requireRoute(it.route), it.amountIn, it.minOut, it.wsolExists ?? false);
  const lock = kind === 'swap' ? [] : [lockInstruction(user, it.minOut, it.unlockAt, it.lockId).ix];
  return [...budget, ...swap, ...lock];
}

export function compile(kind: TxKind, it: PurchaseIntent): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: new PublicKey(it.wallet), recentBlockhash: it.blockhash, instructions: instructionsFor(kind, it),
  }).compileToV0Message([]);
  return new VersionedTransaction(msg);
}

/** Serialized size with its (empty) signature slot: compact-u16(1) + 64 + message. */
export function txSize(tx: VersionedTransaction): number {
  return 1 + 64 * tx.message.header.numRequiredSignatures + tx.message.serialize().length;
}
export function fits(tx: VersionedTransaction): boolean {
  return txSize(tx) <= TX_SIZE_LIMIT;
}

export type Plan = { mode: 'single'; txs: [VersionedTransaction] } | { mode: 'two'; txs: [VersionedTransaction, VersionedTransaction] };

/**
 * Owner decision (brief §9.5-ter): one swap+pass transaction when it fits in 1232 bytes; the
 * priority-fee instruction is only included when the fee is > 0. If it does not fit, two
 * transactions (swap, then pass) go to the wallet in a single request.
 */
export function plan(it: PurchaseIntent, forceTwo = false): Plan {
  const single = compile('single', it);
  if (fits(single) && !forceTwo) return { mode: 'single', txs: [single] };
  const a = compile('swap', it);
  const b = compile('lock', it);
  if (!fits(a) || !fits(b)) throw new Error('transaction too large');
  return { mode: 'two', txs: [a, b] };
}
