/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DAMM_POOL, DAMM_POOL_AUTHORITY, DAMM_PROGRAM, DISC, PASS_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, FRIDGE_PROGRAM } from '../constants';
import { dammEventAuthority, dammSwapData, dammSwapIx, decodeDammPool } from '../meteora';
import { createLockData, createLockIx, decodeLock, lockPda, ata } from '../fridge';
import { LOCK_DISC_B58 } from '../reader';
import { base58 } from '../sig';
import { hexBytes, toHex, u64le } from '../bytes';
import { WALLET, route } from './fixtures';

const anchorDisc = (ns: string, name: string) => createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8).toString('hex');

describe('discriminators (pinned IDLs: fridge idl.json sha256 ff7d8b58…, MeteoraAg/damm-v2-sdk cp_amm.json 0.2.5)', () => {
  it('match Anchor derivation', () => {
    expect(DISC.createLock).toBe(anchorDisc('global', 'create_lock'));
    expect(DISC.claim).toBe(anchorDisc('global', 'claim'));
    expect(DISC.lockAccount).toBe(anchorDisc('account', 'Lock'));
    expect(DISC.dammSwap).toBe(anchorDisc('global', 'swap'));
    expect(DISC.dammPool).toBe(anchorDisc('account', 'Pool'));
  });
  it('match the bytes listed in the pinned Fridge IDL', () => {
    expect([...hexBytes(DISC.createLock)]).toEqual([171, 216, 92, 167, 165, 8, 153, 90]);
    expect([...hexBytes(DISC.claim)]).toEqual([62, 198, 214, 193, 213, 159, 108, 210]);
    expect([...hexBytes(DISC.lockAccount)]).toEqual([8, 255, 36, 202, 210, 22, 57, 137]);
  });
  it('lock discriminator base58 for the getProgramAccounts filter', () => {
    expect(base58(hexBytes(DISC.lockAccount))).toBe(LOCK_DISC_B58);
  });
});

describe('addresses equal the known mainnet values', () => {
  it('cp-amm event authority and the pool authority from the IDL', () => {
    expect(new PublicKey(DAMM_POOL_AUTHORITY).toBase58()).toBe('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC');
    expect(dammEventAuthority().toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe('create_lock encoding (IDL args: amount u64, unlock_at i64, lock_id u64)', () => {
  it('layout', () => {
    const d = createLockData(123n, 1_800_000_000n, 7n);
    expect(d.length).toBe(32);
    expect(toHex(d)).toBe(DISC.createLock + toHex(u64le(123n)) + toHex(u64le(1_800_000_000n)) + toHex(u64le(7n)));
  });
  it('accounts in IDL order with the PDA and the Token-2022 vault', () => {
    const user = new PublicKey(WALLET);
    const mint = new PublicKey(PASS_MINT);
    const { ix, lock, vault } = createLockIx({ depositor: user, mint, amount: 5n, unlockAt: 9n, lockId: 1n });
    expect(ix.programId.toBase58()).toBe(FRIDGE_PROGRAM);
    const [pda] = lockPda(user, mint, 1n);
    expect(lock.equals(pda)).toBe(true);
    expect(vault.equals(ata(pda, mint, TOKEN_2022_PROGRAM))).toBe(true);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [WALLET, true, true],
      [PASS_MINT, false, false],
      [ata(user, mint, TOKEN_2022_PROGRAM).toBase58(), false, true],
      [pda.toBase58(), false, true],
      [vault.toBase58(), false, true],
      [TOKEN_2022_PROGRAM, false, false],
      ['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', false, false],
      ['11111111111111111111111111111111', false, false],
    ]);
  });
  it('decodeLock is strict', () => {
    const d = new Uint8Array(105);
    d.set(hexBytes(DISC.lockAccount));
    expect(decodeLock(d)).not.toBeNull();
    expect(decodeLock(d.subarray(0, 104))).toBeNull();
    const bad = d.slice(); bad[0] = 0;
    expect(decodeLock(bad)).toBeNull();
  });
});

describe('cp-amm swap (IDL args: amount_in u64, minimum_amount_out u64)', () => {
  it('data layout', () => {
    expect(toHex(dammSwapData(10_000_000n, 42n))).toBe(DISC.dammSwap + toHex(u64le(10_000_000n)) + toHex(u64le(42n)));
  });
  it('accounts in IDL order: payer signs, the player wSOL is the input and the pass-token account the output', () => {
    const user = new PublicKey(WALLET);
    const r = route();
    const ix = dammSwapIx(user, r, 10_000_000n, 1_000n);
    expect(ix.programId.toBase58()).toBe(DAMM_PROGRAM);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [DAMM_POOL_AUTHORITY, false, false],
      [DAMM_POOL, false, true],
      [ata(user, new PublicKey(WSOL_MINT), TOKEN_PROGRAM).toBase58(), false, true],
      [ata(user, new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58(), false, true],
      [r.tokenAVault.toBase58(), false, true],
      [r.tokenBVault.toBase58(), false, true],
      [PASS_MINT, false, false],
      [WSOL_MINT, false, false],
      [WALLET, true, false],
      [TOKEN_2022_PROGRAM, false, false],
      [TOKEN_PROGRAM, false, false],
      [DAMM_PROGRAM, false, false], // no referral
      [dammEventAuthority().toBase58(), false, false],
      [DAMM_PROGRAM, false, false],
    ]);
  });
  it('pool decoding is strict', () => {
    const r = route();
    const d = new Uint8Array(1112);
    d.set(hexBytes(DISC.dammPool));
    d.set(r.tokenAMint.toBytes(), 168); d.set(r.tokenBMint.toBytes(), 200); d.set(r.tokenAVault.toBytes(), 232); d.set(r.tokenBVault.toBytes(), 264);
    const p = decodeDammPool(d)!;
    expect(p.tokenAMint.equals(r.tokenAMint) && p.tokenBVault.equals(r.tokenBVault)).toBe(true);
    expect(decodeDammPool(d.subarray(0, 295))).toBeNull();
    const bad = d.slice(); bad[0] = bad[0]! ^ 1;
    expect(decodeDammPool(bad)).toBeNull();
  });
});

describe('receipt rule on the Meteora swap (the proof of payment now that the amount follows the market)', () => {
  const lockOf = (amount: bigint) => {
    const user = new PublicKey(WALLET);
    const { lock, vault } = createLockIx({ depositor: user, mint: new PublicKey(PASS_MINT), amount, unlockAt: 9n, lockId: 3n });
    return { address: lock.toBase58(), vault: vault.toBase58(), amount } as never;
  };
  it('accepts the creating transaction: pool swap of at least 0.01 SOL, lock amount equal to its minimum out', async () => {
    const { compile } = await import('../txbuilder');
    const { receiptFromCreatingTx } = await import('../receipt');
    const { intent, BLOCKHASH } = await import('./fixtures');
    expect(BLOCKHASH.length).toBeGreaterThan(30);
    const it0 = intent();
    const lock = lockOf(it0.minOut);
    // The lock PDA of the intent is the receipt's subject.
    const real = createLockIx({ depositor: new PublicKey(WALLET), mint: new PublicKey(PASS_MINT), amount: it0.minOut, unlockAt: it0.unlockAt, lockId: it0.lockId });
    const subject = { ...(lock as object), address: real.lock.toBase58(), amount: it0.minOut } as never;
    const raw = compile('single', it0).serialize();
    expect(receiptFromCreatingTx(raw, subject, WALLET)).toBe(true);
    // A lock that holds a different amount than the swap guaranteed is not receipted.
    expect(receiptFromCreatingTx(raw, { ...(subject as object), amount: it0.minOut + 1n } as never, WALLET)).toBe(false);
    // A transaction without the swap (lock only) proves nothing.
    expect(receiptFromCreatingTx(compile('lock', it0).serialize(), subject, WALLET)).toBe(false);
    // Another wallet's receipt is not ours.
    expect(receiptFromCreatingTx(raw, subject, 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ')).toBe(false);
  });
});
