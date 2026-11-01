import './polyfill';
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { u64le, concat } from './bytes';
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM } from './constants';
import { ata } from './fridge';

/** The handful of SPL / ComputeBudget instructions the pass needs, encoded from their specs. */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ATA_PROGRAM),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.from([1])),
  });
}
export function syncNativeIx(account: PublicKey, tokenProgram: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(tokenProgram),
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from(Uint8Array.from([17])),
  });
}
export function closeAccountIx(account: PublicKey, dest: PublicKey, owner: PublicKey, tokenProgram: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(tokenProgram),
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.from([9])),
  });
}
export function transferLamportsIx(from: PublicKey, to: PublicKey, lamports: bigint): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}
export function setCuLimitIx(units: number): TransactionInstruction {
  const d = new Uint8Array(5);
  d[0] = 2;
  new DataView(d.buffer).setUint32(1, units, true);
  return new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [], data: Buffer.from(d) });
}
export function setCuPriceIx(microLamports: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [],
    data: Buffer.from(concat(Uint8Array.from([3]), u64le(BigInt(microLamports)))),
  });
}
