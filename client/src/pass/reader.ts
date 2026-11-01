import './polyfill';
import { PublicKey } from '@solana/web3.js';
import { b64ToBytes, readU64 } from './bytes';
import { FRIDGE_PROGRAM, LOCK_ACCOUNT_SIZE, MAX_LOCK_ID, PASS_MINT, TOKEN_2022_PROGRAM } from './constants';
import { ata, decodeLock, lockPda, type DecodedLock } from './fridge';
import { getMultipleAccounts, type AccountInfoB64, type Rpc } from './rpc';

/** base58 of the Lock discriminator 08ff24cad2163989 (unit-tested). */
export const LOCK_DISC_B58 = '2WHAy3LEoEg';

export interface VerifiedLock extends DecodedLock {
  address: string;
  vault: string;
  vaultAmount: bigint;
  /** Lamports held by the lock account (returned when the pass is redeemed). */
  lamports: number;
}

export interface LockSnapshot {
  /** Unix seconds when the read finished (device clock). */
  ts: number;
  locks: VerifiedLock[];
  /** true when only the fixed-ID fallback could run (locks with other IDs may exist). */
  partial: boolean;
  /** Lock ids 1..64 already used (open accounts) — never reuse one. */
  usedIds: Set<number>;
}

export type ReadResult = { ok: true; snapshot: LockSnapshot } | { ok: false; reason: 'unavailable' };

const mint = new PublicKey(PASS_MINT);

/**
 * Verify one candidate lock account. Rejects anything that is not exactly a Fridge lock for this
 * wallet + the pass token at its canonical PDA. Vault checks happen in a second batched read.
 */
export function verifyLockAccount(address: string, info: AccountInfoB64 | null, wallet: PublicKey): DecodedLock | null {
  if (!info || info.owner !== FRIDGE_PROGRAM || info.executable) return null;
  const data = b64ToBytes(info.data[0]);
  if (data.length !== LOCK_ACCOUNT_SIZE) return null;
  const l = decodeLock(data);
  if (!l) return null;
  if (!l.depositor.equals(wallet) || !l.mint.equals(mint)) return null;
  const [pda, bump] = lockPda(wallet, mint, l.lockId);
  if (pda.toBase58() !== address || bump !== l.bump) return null;
  if (l.amount <= 0n || l.unlockAt <= l.createdAt) return null;
  return l;
}

/** Token-2022 account layout: mint 0..32, owner 32..64, amount 64..72, state 108. */
export function verifyVault(info: AccountInfoB64 | null, lock: PublicKey, amount: bigint): bigint | null {
  if (!info || info.owner !== TOKEN_2022_PROGRAM) return null;
  const d = b64ToBytes(info.data[0]);
  if (d.length < 165) return null;
  if (!new PublicKey(d.subarray(0, 32)).equals(mint)) return null;
  if (!new PublicKey(d.subarray(32, 64)).equals(lock)) return null;
  if (d[108] !== 1) return null; // initialized, not frozen
  const bal = readU64(d, 64);
  return bal >= amount ? bal : null;
}

export async function readLocks(rpc: Rpc, walletB58: string, extraIds: number[] = []): Promise<ReadResult> {
  const wallet = new PublicKey(walletB58);
  const candidates = new Map<string, AccountInfoB64 | null>();
  let partial = false;
  try {
    const res = await rpc.call<{ pubkey: string; account: AccountInfoB64 }[]>('getProgramAccounts', [FRIDGE_PROGRAM, {
      encoding: 'base64', commitment: 'confirmed',
      filters: [
        { dataSize: LOCK_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: LOCK_DISC_B58 } },
        { memcmp: { offset: 8, bytes: walletB58 } },
        { memcmp: { offset: 40, bytes: PASS_MINT } },
      ],
    }]);
    for (const r of res) candidates.set(r.pubkey, r.account);
    // Recently created locks may lag in the index: also read the ids we know about.
    if (extraIds.length) {
      const keys = extraIds.map((id) => lockPda(wallet, mint, BigInt(id))[0].toBase58());
      const infos = await getMultipleAccounts(rpc, keys);
      keys.forEach((k, i) => { if (infos[i]) candidates.set(k, infos[i]!); });
    }
  } catch {
    // Fallback: fixed ids 1..64 (the ids this app uses). Cannot discover foreign ids.
    try {
      const keys: string[] = [];
      for (let id = 1; id <= MAX_LOCK_ID; id++) keys.push(lockPda(wallet, mint, BigInt(id))[0].toBase58());
      const infos = await getMultipleAccounts(rpc, keys);
      keys.forEach((k, i) => { if (infos[i]) candidates.set(k, infos[i]!); });
      partial = true;
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }
  const decoded: { address: string; lock: DecodedLock; lamports: number }[] = [];
  for (const [address, info] of candidates) {
    const l = verifyLockAccount(address, info, wallet);
    if (l) decoded.push({ address, lock: l, lamports: info!.lamports });
  }
  const vaults = decoded.map((d) => ata(new PublicKey(d.address), mint, TOKEN_2022_PROGRAM).toBase58());
  let vaultInfos: (AccountInfoB64 | null)[] = [];
  if (vaults.length) {
    try { vaultInfos = await getMultipleAccounts(rpc, vaults); } catch { return { ok: false, reason: 'unavailable' }; }
  }
  const locks: VerifiedLock[] = [];
  const usedIds = new Set<number>();
  decoded.forEach((d, i) => {
    if (d.lock.lockId >= 1n && d.lock.lockId <= BigInt(MAX_LOCK_ID)) usedIds.add(Number(d.lock.lockId));
    const bal = verifyVault(vaultInfos[i] ?? null, new PublicKey(d.address), d.lock.amount);
    if (bal === null) return;
    locks.push({ ...d.lock, address: d.address, vault: vaults[i]!, vaultAmount: bal, lamports: d.lamports });
  });
  return { ok: true, snapshot: { ts: Math.floor(Date.now() / 1000), locks, partial, usedIds } };
}

/** First lock id in 1..64 that is neither open on chain nor reserved by a pending purchase. */
export function firstFreeLockId(used: Set<number>, reserved: Iterable<number>): number | null {
  const r = new Set(reserved);
  for (let id = 1; id <= MAX_LOCK_ID; id++) if (!used.has(id) && !r.has(id)) return id;
  return null;
}
