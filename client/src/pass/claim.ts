import './polyfill';
import { Buffer } from 'buffer';
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
  ATA_PROGRAM, CLAIM_FEE_BPS, CLAIM_SLIPPAGE_BPS, COMPUTE_BUDGET_PROGRAM, FRIDGE_PROGRAM, JUPITER_API, JUPITER_V6_PROGRAM,
  MAX_PRIORITY_MICROLAMPORTS, PASTA_MINT, PASS_MINT, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TX_SIZE_LIMIT,
} from './constants';
import { ata, burnPda, claimData, lockPda } from './fridge';
import { b64ToBytes, bytesToB64, eqBytes, hexBytes } from './bytes';
import { DISC } from './constants';
import { getLatestBlockhash, getMultipleAccounts, getPriorityFee, simulate, type Rpc } from './rpc';
import type { VerifiedLock } from './reader';
import { classifyChainError, type ChainFailure } from './errors';

/** Claim compute limit (Fridge + a Jupiter route + burn). */
export const CLAIM_COMPUTE_UNIT_LIMIT = 400_000;
/** The program skips the buyback below this vault amount (fee rounds to 0). */
export const CLAIM_MIN_FEE_AMOUNT = 50n;

export function claimFee(vaultAmount: bigint): bigint {
  return vaultAmount < CLAIM_MIN_FEE_AMOUNT ? 0n : (vaultAmount * CLAIM_FEE_BPS) / 10_000n;
}

interface JupIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
export interface JupiterRoute {
  swap: JupIx;
  minPastaOut: bigint;
  lookupTables: string[];
}

export type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;
const defaultFetch: FetchJson = async (url, init) => {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  if (!r.ok && !(j && typeof j === 'object' && 'errorCode' in j)) throw new Error(`http ${r.status}`);
  return j;
};

export type RouteResult = { ok: true; route: JupiterRoute } | { ok: false; reason: 'no-route' | 'unavailable' };

/**
 * The locked token IS the fee token (PASTA): there is nothing to swap, so the claim is built without a Jupiter route.
 * UNVERIFIED on mainnet: how the Fridge program takes the 2% from a PASTA lock can only be confirmed with a real lock;
 * the claim is simulated before the wallet sees it, so a program that disagrees fails closed here and the funds stay locked.
 */
const FEE_IN_LOCKED_TOKEN = PASS_MINT === PASTA_MINT;

/** Quote the locked token → PASTA for the fee, with the burn authority PDA as the swapping user. */
export async function fetchBuybackRoute(fee: bigint, maxAccounts: number, fetchJson: FetchJson = defaultFetch): Promise<RouteResult> {
  let quote: Record<string, unknown>;
  try {
    quote = (await fetchJson(`${JUPITER_API}/quote?inputMint=${PASS_MINT}&outputMint=${PASTA_MINT}&amount=${fee}`
      + `&slippageBps=${CLAIM_SLIPPAGE_BPS}&maxAccounts=${maxAccounts}`)) as Record<string, unknown>;
  } catch { return { ok: false, reason: 'unavailable' }; }
  if (!quote || quote.errorCode === 'NO_ROUTES_FOUND' || quote.errorCode === 'TOKEN_NOT_TRADABLE' || quote.errorCode === 'COULD_NOT_FIND_ANY_ROUTE') return { ok: false, reason: 'no-route' };
  if (typeof quote.otherAmountThreshold !== 'string') return { ok: false, reason: 'unavailable' };
  let sw: Record<string, unknown>;
  try {
    sw = (await fetchJson(`${JUPITER_API}/swap-instructions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: burnPda().toBase58(), wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false, asLegacyTransaction: false }),
    })) as Record<string, unknown>;
  } catch { return { ok: false, reason: 'unavailable' }; }
  const swap = sw?.swapInstruction as JupIx | undefined;
  if (!swap || swap.programId !== JUPITER_V6_PROGRAM) return { ok: false, reason: 'unavailable' };
  const minPastaOut = BigInt(quote.otherAmountThreshold as string);
  if (minPastaOut <= 0n) return { ok: false, reason: 'no-route' };
  return { ok: true, route: { swap, minPastaOut, lookupTables: (sw.addressLookupTableAddresses as string[] | undefined) ?? [] } };
}

function ataIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: string): TransactionInstruction {
  const a = ata(owner, mint, tokenProgram);
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: a, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export interface ClaimIntent {
  wallet: string;
  lock: VerifiedLock;
  pastaProgram: string;
  route: JupiterRoute | null;
  cuPrice: number;
  blockhash: string;
}

export function claimInstructions(it: ClaimIntent): TransactionInstruction[] {
  const w = new PublicKey(it.wallet);
  const mint = new PublicKey(PASS_MINT);
  const pasta = new PublicKey(PASTA_MINT);
  const burn = burnPda();
  const [lock] = lockPda(w, mint, it.lock.lockId);
  const depAta = ata(w, mint, TOKEN_2022_PROGRAM);
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CLAIM_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: it.cuPrice }),
    ataIdempotent(w, w, mint, TOKEN_2022_PROGRAM),
  ];
  const remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  if (it.route) {
    ixs.push(ataIdempotent(w, burn, mint, TOKEN_2022_PROGRAM), ataIdempotent(w, burn, pasta, it.pastaProgram));
    remaining.push(
      { pubkey: pasta, isSigner: false, isWritable: true },
      { pubkey: ata(burn, mint, TOKEN_2022_PROGRAM), isSigner: false, isWritable: true },
      { pubkey: ata(burn, pasta, it.pastaProgram), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(JUPITER_V6_PROGRAM), isSigner: false, isWritable: false },
      // The burn PDA signs inside the program (invoke_signed): never a top-level signer.
      ...it.route.swap.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: false, isWritable: a.isWritable })),
    );
  }
  ixs.push(new TransactionInstruction({
    programId: new PublicKey(FRIDGE_PROGRAM),
    keys: [
      { pubkey: w, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: depAta, isSigner: false, isWritable: true },
      { pubkey: lock, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(it.lock.vault), isSigner: false, isWritable: true },
      { pubkey: burn, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_2022_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(ATA_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      ...remaining,
    ],
    data: Buffer.from(claimData(it.route ? b64ToBytes(it.route.swap.data) : new Uint8Array(0), it.route?.minPastaOut ?? 0n)),
  }));
  return ixs;
}

export function compileClaim(it: ClaimIntent, tables: AddressLookupTableAccount[]): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: new PublicKey(it.wallet), recentBlockhash: it.blockhash, instructions: claimInstructions(it) })
    .compileToV0Message(tables);
  return new VersionedTransaction(msg);
}

export async function loadTables(rpc: Rpc, keys: string[]): Promise<AddressLookupTableAccount[]> {
  if (!keys.length) return [];
  const infos = await getMultipleAccounts(rpc, keys);
  return infos.map((info, i) => {
    if (!info) throw new Error('lookup table missing');
    return new AddressLookupTableAccount({ key: new PublicKey(keys[i]!), state: AddressLookupTableAccount.deserialize(b64ToBytes(info.data[0])) });
  });
}

/**
 * Independent check of the claim bytes the wallet will see (LUTs resolved): one signer (the
 * wallet, also the payer), only ComputeBudget / ATA / Fridge at top level, exactly one Fridge
 * claim for OUR lock, the buyback through Jupiter, bounded compute price.
 */
export function validateClaim(raw: Uint8Array, it: ClaimIntent, tables: AddressLookupTableAccount[]): { ok: true } | { ok: false; reason: string } {
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(raw); } catch { return { ok: false, reason: 'undecodable' }; }
  if (raw.length > TX_SIZE_LIMIT) return { ok: false, reason: 'too large' };
  const m = tx.message;
  if (m.header.numRequiredSignatures !== 1) return { ok: false, reason: 'signer count' };
  if (tx.signatures.some((s) => s.some((b) => b !== 0))) return { ok: false, reason: 'already signed' };
  let keys;
  try { keys = m.getAccountKeys({ addressLookupTableAccounts: tables }); } catch { return { ok: false, reason: 'lookup mismatch' }; }
  const key = (i: number) => keys.get(i)?.toBase58() ?? '';
  if (key(0) !== it.wallet) return { ok: false, reason: 'payer' };
  if (m.recentBlockhash !== it.blockhash) return { ok: false, reason: 'blockhash' };
  const w = new PublicKey(it.wallet);
  const [lock] = lockPda(w, new PublicKey(PASS_MINT), it.lock.lockId);
  let claims = 0; let cuPrice: bigint | null = null; let cuLimit: number | null = null;
  for (const ix of m.compiledInstructions) {
    const prog = key(ix.programIdIndex);
    if (prog === COMPUTE_BUDGET_PROGRAM) {
      const d = ix.data;
      if (d[0] === 2 && d.length === 5) { if (cuLimit !== null) return { ok: false, reason: 'cu limit twice' }; cuLimit = new DataView(d.buffer, d.byteOffset).getUint32(1, true); }
      else if (d[0] === 3 && d.length === 9) { if (cuPrice !== null) return { ok: false, reason: 'cu price twice' }; cuPrice = new DataView(d.buffer, d.byteOffset).getBigUint64(1, true); }
      else return { ok: false, reason: 'compute budget op' };
    } else if (prog === ATA_PROGRAM) {
      if (!(ix.data.length === 1 && ix.data[0] === 1) || key(ix.accountKeyIndexes[0]!) !== it.wallet) return { ok: false, reason: 'ata op' };
    } else if (prog === FRIDGE_PROGRAM) {
      claims++;
      if (!eqBytes(ix.data.subarray(0, 8), hexBytes(DISC.claim))) return { ok: false, reason: 'fridge op' };
      const a = ix.accountKeyIndexes.map(key);
      if (a[0] !== it.wallet || a[1] !== PASS_MINT || a[3] !== lock.toBase58() || a[4] !== it.lock.vault || a[5] !== burnPda().toBase58()) return { ok: false, reason: 'claim accounts' };
      if (it.route && a[12] !== JUPITER_V6_PROGRAM) return { ok: false, reason: 'buyback program' };
    } else return { ok: false, reason: `program ${prog}` };
  }
  if (claims !== 1) return { ok: false, reason: 'claim count' };
  if (cuLimit === null || cuLimit > CLAIM_COMPUTE_UNIT_LIMIT) return { ok: false, reason: 'cu limit' };
  if (cuPrice === null || cuPrice > BigInt(MAX_PRIORITY_MICROLAMPORTS)) return { ok: false, reason: 'cu price' };
  return { ok: true };
}

export type ClaimBuild =
  | { ok: true; tx: VersionedTransaction; intent: ClaimIntent; lastValidBlockHeight: number; returnedLamports: bigint }
  | { ok: false; reason: 'not-ended' | 'no-route' | 'unavailable' | 'too-large' | 'validation'; detail?: string }
  | { ok: false; reason: 'chain'; failure: ChainFailure };

/** Build, validate and simulate the release of one ended pass. Never signs. */
export async function buildClaim(rpc: Rpc, wallet: string, lock: VerifiedLock, nowS: number, fetchJson: FetchJson = defaultFetch): Promise<ClaimBuild> {
  if (Number(lock.unlockAt) > nowS) return { ok: false, reason: 'not-ended' };
  const fee = claimFee(lock.vaultAmount);
  const [[pastaInfo, vaultInfo], bh, cuPrice] = await Promise.all([
    getMultipleAccounts(rpc, [PASTA_MINT, lock.vault]), getLatestBlockhash(rpc), getPriorityFee(rpc, [FRIDGE_PROGRAM]),
  ]);
  if (!pastaInfo) return { ok: false, reason: 'unavailable' };
  let last: ClaimBuild = { ok: false, reason: 'too-large' };
  for (const maxAccounts of fee > 0n && !FEE_IN_LOCKED_TOKEN ? [32, 24, 16] : [0]) {
    let route: JupiterRoute | null = null;
    if (fee > 0n && !FEE_IN_LOCKED_TOKEN) {
      const r = await fetchBuybackRoute(fee, maxAccounts, fetchJson);
      if (!r.ok) return { ok: false, reason: r.reason };
      route = r.route;
    }
    const intent: ClaimIntent = { wallet, lock, pastaProgram: pastaInfo.owner, route, cuPrice: Math.min(Math.ceil(cuPrice), MAX_PRIORITY_MICROLAMPORTS), blockhash: bh.blockhash };
    let tables: AddressLookupTableAccount[];
    try { tables = await loadTables(rpc, route?.lookupTables ?? []); } catch { return { ok: false, reason: 'unavailable' }; }
    let tx: VersionedTransaction;
    try { tx = compileClaim(intent, tables); } catch { last = { ok: false, reason: 'too-large' }; continue; }
    let raw: Uint8Array;
    try { raw = tx.serialize(); } catch { last = { ok: false, reason: 'too-large' }; continue; }
    if (raw.length > TX_SIZE_LIMIT) { last = { ok: false, reason: 'too-large' }; continue; }
    const v = validateClaim(raw, intent, tables);
    if (!v.ok) return { ok: false, reason: 'validation', detail: v.reason };
    const sim = await simulate(rpc, bytesToB64(raw), [], false);
    if (sim.err) {
      const progs = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? '');
      return { ok: false, reason: 'chain', failure: classifyChainError(sim.err, sim.logs, progs) };
    }
    return { ok: true, tx, intent, lastValidBlockHeight: bh.lastValidBlockHeight, returnedLamports: BigInt(lock.lamports + (vaultInfo?.lamports ?? 0)) };
  }
  return last;
}
