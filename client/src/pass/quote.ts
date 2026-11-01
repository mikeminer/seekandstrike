import './polyfill';
import { PublicKey } from '@solana/web3.js';
import { PASS_MINT, TOKEN_2022_PROGRAM } from './constants';
import { ata } from './fridge';
import { b64ToBytes, bytesToB64, readU64 } from './bytes';
import type { DammRoute } from './meteora';
import { simulate, type AccountInfoB64, type Rpc } from './rpc';
import { compile } from './txbuilder';
import { classifyChainError, type ChainFailure } from './errors';
import type { Simulate } from './math';

export class QuoteError extends Error {
  constructor(readonly failure: ChainFailure) { super(failure.kind); }
}

/** Token account amount (SPL / Token-2022 share the base layout). 0 when the account is missing. */
export function tokenAmount(info: AccountInfoB64 | null | undefined): bigint {
  if (!info) return 0n;
  const d = b64ToBytes(info.data[0]);
  return d.length >= 72 ? readU64(d, 64) : 0n;
}

/**
 * Exact quote by simulation (read-only, sigVerify false): the swap-only transaction of the wallet
 * itself with min_out = 1, and the pass token received read from the simulated post-state. Includes
 * every pool/curve fee and any transfer fee, so it matches what the real transaction will do.
 */
export function simQuoter(rpc: Rpc, wallet: string, route: DammRoute, preAmount: bigint, wsolExists = false): Simulate {
  const userAta = ata(new PublicKey(wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
  const cache = new Map<bigint, Promise<bigint>>();
  return (amountIn: bigint) => {
    const hit = cache.get(amountIn);
    if (hit) return hit;
    const p = (async () => {
      const tx = compile('swap', {
        wallet, route, wsolExists, amountIn, minOut: 1n, target: 1n, lockId: 1n, unlockAt: 0n, cuPrice: 0,
        blockhash: '11111111111111111111111111111111',
      });
      const r = await simulate(rpc, bytesToB64(tx.serialize()), [userAta], true);
      if (r.err) throw new QuoteError(classifyChainError(r.err, r.logs, tx.message.compiledInstructions.map((i) => tx.message.staticAccountKeys[i.programIdIndex]!.toBase58())));
      const post = tokenAmount(r.accounts?.[0] ?? null);
      const out = post - preAmount;
      return out > 0n ? out : 0n;
    })();
    cache.set(amountIn, p);
    p.catch(() => cache.delete(amountIn));
    return p;
  };
}
