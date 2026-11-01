import './polyfill';
import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { concat, eqBytes, hexBytes, i64le, readI64, readU64, u64le } from './bytes';
import {
  ATA_PROGRAM, DISC, FRIDGE_PROGRAM, LOCK_ACCOUNT_SIZE, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM,
} from './constants';

/** Fridge program encoders/decoders, pinned to IDL b8685f4f (sha ff7d8b58…). */
export const fridgeProgram = new PublicKey(FRIDGE_PROGRAM);

export function lockPda(depositor: PublicKey, mint: PublicKey, lockId: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('lock'), depositor.toBytes(), mint.toBytes(), u64le(lockId)],
    fridgeProgram,
  );
}
export function burnPda(): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('burn')], fridgeProgram)[0];
}
/** Associated token address (owner may be off-curve: PDA vaults). */
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), new PublicKey(tokenProgram).toBytes(), mint.toBytes()],
    new PublicKey(ATA_PROGRAM),
  )[0];
}

export interface CreateLockArgs {
  depositor: PublicKey; mint: PublicKey; amount: bigint; unlockAt: bigint; lockId: bigint;
}
export function createLockData(amount: bigint, unlockAt: bigint, lockId: bigint): Uint8Array {
  return concat(hexBytes(DISC.createLock), u64le(amount), i64le(unlockAt), u64le(lockId));
}
export function createLockIx(a: CreateLockArgs): { ix: TransactionInstruction; lock: PublicKey; vault: PublicKey } {
  if (a.amount <= 0n) throw new Error('amount must be > 0');
  if (a.lockId < 1n) throw new Error('lock id must be >= 1');
  const [lock] = lockPda(a.depositor, a.mint, a.lockId);
  const vault = ata(lock, a.mint, TOKEN_2022_PROGRAM);
  const depositorAta = ata(a.depositor, a.mint, TOKEN_2022_PROGRAM);
  const ix = new TransactionInstruction({
    programId: fridgeProgram,
    keys: [
      { pubkey: a.depositor, isSigner: true, isWritable: true },
      { pubkey: a.mint, isSigner: false, isWritable: false },
      { pubkey: depositorAta, isSigner: false, isWritable: true },
      { pubkey: lock, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TOKEN_2022_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(ATA_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(createLockData(a.amount, a.unlockAt, a.lockId)),
  });
  return { ix, lock, vault };
}

export interface DecodedLock {
  depositor: PublicKey; mint: PublicKey; amount: bigint; createdAt: bigint; unlockAt: bigint;
  bump: number; lockId: bigint;
}
/** Strict decode: exact size + discriminator. Owner/PDA checks are done by the verifier. */
export function decodeLock(data: Uint8Array): DecodedLock | null {
  if (data.length !== LOCK_ACCOUNT_SIZE) return null;
  if (!eqBytes(data.subarray(0, 8), hexBytes(DISC.lockAccount))) return null;
  return {
    depositor: new PublicKey(data.subarray(8, 40)),
    mint: new PublicKey(data.subarray(40, 72)),
    amount: readU64(data, 72),
    createdAt: readI64(data, 80),
    unlockAt: readI64(data, 88),
    bump: data[96]!,
    lockId: readU64(data, 97),
  };
}

/** Fridge custom error codes (IDL). The UI maps them to plain sentences (ui/copy.ts). */
export const FRIDGE_ERRORS: Record<number, string> = {
  6000: 'InvalidAmount', 6001: 'InvalidUnlockTime', 6002: 'InvalidMint', 6003: 'InvalidTokenAccount',
  6004: 'InvalidAuthority', 6005: 'Unauthorized', 6006: 'LockNotMatured', 6007: 'Overflow',
  6008: 'InsufficientBalance', 6009: 'MissingSwapRoute', 6010: 'InvalidSwapProgram',
  6011: 'BuybackFailed', 6012: 'InvalidBoostTier', 6013: 'NeedLiveLock', 6014: 'InsufficientVault',
};

/** claim(swap_data: bytes, min_pasta_out: u64) */
export function claimData(swapData: Uint8Array, minPastaOut: bigint): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, swapData.length, true);
  return concat(hexBytes(DISC.claim), len, swapData, u64le(minPastaOut));
}
