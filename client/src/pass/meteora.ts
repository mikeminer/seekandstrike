import './polyfill';
import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { b64ToBytes, concat, eqBytes, hexBytes, u64le } from './bytes';
import {
  DAMM_POOL, DAMM_POOL_AUTHORITY, DAMM_PROGRAM, DISC, PASS_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT,
} from './constants';
import { ata } from './fridge';
import { getMultipleAccounts, type Rpc } from './rpc';

/**
 * Meteora DAMM v2 (cp-amm) `swap`, encoded by hand from the pinned IDL (cp_amm 0.2.5) so the client bundle needs no
 * Anchor. The Daily Pass buys the pass token in this single pool: input = the player's wSOL account (token B),
 * output = the player's pass-token account (token A, Token-2022).
 */
const program = new PublicKey(DAMM_PROGRAM);

export function dammEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('__event_authority')], program)[0];
}

export interface DammRoute {
  pool: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  tokenAProgram: string;
  tokenBProgram: string;
}

export function dammSwapData(amountIn: bigint, minOut: bigint): Uint8Array {
  return concat(hexBytes(DISC.dammSwap), u64le(amountIn), u64le(minOut));
}

/** Buy: spend `amountIn` wSOL, receive at least `minOut` of the pass token. */
export function dammSwapIx(user: PublicKey, r: DammRoute, amountIn: bigint, minOut: bigint): TransactionInstruction {
  const ro = (k: PublicKey) => ({ pubkey: k, isSigner: false, isWritable: false });
  const rw = (k: PublicKey) => ({ pubkey: k, isSigner: false, isWritable: true });
  return new TransactionInstruction({
    programId: program,
    keys: [
      ro(new PublicKey(DAMM_POOL_AUTHORITY)),
      rw(r.pool),
      rw(ata(user, r.tokenBMint, r.tokenBProgram)),
      rw(ata(user, r.tokenAMint, r.tokenAProgram)),
      rw(r.tokenAVault),
      rw(r.tokenBVault),
      ro(r.tokenAMint),
      ro(r.tokenBMint),
      { pubkey: user, isSigner: true, isWritable: false },
      ro(new PublicKey(r.tokenAProgram)),
      ro(new PublicKey(r.tokenBProgram)),
      ro(program), // optional referral account: the program id itself means "none"
      ro(dammEventAuthority()),
      ro(program),
    ],
    data: Buffer.from(dammSwapData(amountIn, minOut)),
  });
}

// ---------- on-chain route resolution (read-only) ----------
export interface DecodedDammPool { tokenAMint: PublicKey; tokenBMint: PublicKey; tokenAVault: PublicKey; tokenBVault: PublicKey }
export function decodeDammPool(data: Uint8Array): DecodedDammPool | null {
  if (data.length < 296 || !eqBytes(data.subarray(0, 8), hexBytes(DISC.dammPool))) return null;
  return {
    tokenAMint: new PublicKey(data.subarray(168, 200)),
    tokenBMint: new PublicKey(data.subarray(200, 232)),
    tokenAVault: new PublicKey(data.subarray(232, 264)),
    tokenBVault: new PublicKey(data.subarray(264, 296)),
  };
}

export type RouteResult =
  | { ok: true; route: DammRoute }
  | { ok: false; reason: 'route-unavailable' | 'rpc' };

/** Reads the pool and both mints; anything that is not exactly pass token (Token-2022) / wSOL fails closed. */
export async function resolveRoute(rpc: Rpc): Promise<RouteResult> {
  let infos;
  try {
    infos = await getMultipleAccounts(rpc, [DAMM_POOL, PASS_MINT, WSOL_MINT]);
  } catch {
    return { ok: false, reason: 'rpc' };
  }
  const [p, mPass, mWsol] = infos;
  if (!p || p.owner !== DAMM_PROGRAM || !mPass || !mWsol) return { ok: false, reason: 'route-unavailable' };
  if (mPass.owner !== TOKEN_2022_PROGRAM || mWsol.owner !== TOKEN_PROGRAM) return { ok: false, reason: 'route-unavailable' };
  const d = decodeDammPool(b64ToBytes(p.data[0]));
  if (!d || d.tokenAMint.toBase58() !== PASS_MINT || d.tokenBMint.toBase58() !== WSOL_MINT) return { ok: false, reason: 'route-unavailable' };
  return {
    ok: true,
    route: {
      pool: new PublicKey(DAMM_POOL), tokenAMint: d.tokenAMint, tokenBMint: d.tokenBMint,
      tokenAVault: d.tokenAVault, tokenBVault: d.tokenBVault, tokenAProgram: TOKEN_2022_PROGRAM, tokenBProgram: TOKEN_PROGRAM,
    },
  };
}

/** cp-amm error 6002 `ExceededSlippage`. */
export const SLIPPAGE_ERRORS = { [DAMM_PROGRAM]: new Set([6002]) } as Record<string, Set<number>>;
