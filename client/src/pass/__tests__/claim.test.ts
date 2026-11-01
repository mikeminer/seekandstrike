import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { claimFee, claimInstructions, compileClaim, fetchBuybackRoute, validateClaim, type ClaimIntent } from '../claim';
import { ata, burnPda, lockPda } from '../fridge';
import { JUPITER_V6_PROGRAM, PASS_SECONDS, PASS_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../constants';
import { BLOCKHASH, NOW, WALLET } from './fixtures';
import type { VerifiedLock } from '../reader';

const w = new PublicKey(WALLET);
const mint = new PublicKey(PASS_MINT);
const [lockAddr, bump] = lockPda(w, mint, 5n);
const lock: VerifiedLock = {
  depositor: w, mint, amount: 1_450_000_000_000n, createdAt: BigInt(NOW - PASS_SECONDS), unlockAt: BigInt(NOW), bump, lockId: 5n,
  address: lockAddr.toBase58(), vault: ata(lockAddr, mint, TOKEN_2022_PROGRAM).toBase58(), vaultAmount: 1_450_000_000_000n, lamports: 1_183_640,
};
const jupAccounts = Array.from({ length: 10 }, (_, i) => ({ pubkey: Keypair.generate().publicKey.toBase58(), isSigner: i === 0, isWritable: i % 2 === 0 }));
jupAccounts[0]!.pubkey = burnPda().toBase58();
const route = { swap: { programId: JUPITER_V6_PROGRAM, accounts: jupAccounts, data: Buffer.from([1, 2, 3, 4]).toString('base64') }, minPastaOut: 123n, lookupTables: [] };
const base = (over: Partial<ClaimIntent> = {}): ClaimIntent => ({ wallet: WALLET, lock, pastaProgram: TOKEN_PROGRAM, route, cuPrice: 1000, blockhash: BLOCKHASH, ...over });

describe('claim fee', () => {
  it('2% of the vault, 0 below 50 raw', () => {
    expect(claimFee(10_000n)).toBe(200n);
    expect(claimFee(49n)).toBe(0n);
    expect(claimFee(50n)).toBe(1n);
  });
});

describe('fetchBuybackRoute', () => {
  it('NO_ROUTES_FOUND → no-route (the UI shows "waiting")', async () => {
    const r = await fetchBuybackRoute(100n, 32, async () => ({ error: 'No routes found', errorCode: 'NO_ROUTES_FOUND' }));
    expect(r).toEqual({ ok: false, reason: 'no-route' });
  });
  it('network failure → unavailable', async () => {
    const r = await fetchBuybackRoute(100n, 32, async () => { throw new Error('down'); });
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('a route whose swap is not Jupiter v6 is refused', async () => {
    let n = 0;
    const r = await fetchBuybackRoute(100n, 32, async () => (n++ === 0 ? { otherAmountThreshold: '5' } : { swapInstruction: { ...route.swap, programId: TOKEN_PROGRAM } }));
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('uses the burn PDA as the swapping user and returns otherAmountThreshold', async () => {
    const calls: { url: string; body?: string }[] = [];
    const r = await fetchBuybackRoute(100n, 24, async (url, init) => {
      calls.push({ url, body: init?.body as string | undefined });
      return calls.length === 1 ? { otherAmountThreshold: '77' } : { swapInstruction: route.swap, addressLookupTableAddresses: [] };
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.route.minPastaOut).toBe(77n);
    expect(calls[0]!.url).toContain('maxAccounts=24');
    expect(JSON.parse(calls[1]!.body!).userPublicKey).toBe(burnPda().toBase58());
  });
});

describe('claim instructions + validateClaim', () => {
  it('remaining accounts: PASTA mint, fee ATA, PASTA ATA, Jupiter at index 12; no inner signer flags', () => {
    const ixs = claimInstructions(base());
    const claim = ixs[ixs.length - 1]!;
    expect(claim.keys[12]!.pubkey.toBase58()).toBe(JUPITER_V6_PROGRAM);
    expect(claim.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([WALLET]);
    expect(claim.keys[10]!.pubkey.toBase58()).toBe(ata(burnPda(), mint, TOKEN_2022_PROGRAM).toBase58());
  });
  it('a correct claim validates; one signer', () => {
    const tx = compileClaim(base(), []);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(validateClaim(tx.serialize(), base(), [])).toEqual({ ok: true });
  });
  it('no-fee claim (vault < 50) has no buyback accounts and validates', () => {
    const it = base({ route: null });
    const tx = compileClaim(it, []);
    expect(validateClaim(tx.serialize(), it, [])).toEqual({ ok: true });
  });
  const attack = (ixs: TransactionInstruction[], payer = w) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message()).serialize();
  it('rejects an extra program (e.g. a token transfer)', () => {
    const ixs = claimInstructions(base());
    ixs.push(new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [{ pubkey: w, isSigner: true, isWritable: true }], data: Buffer.from([3]) }));
    expect(validateClaim(attack(ixs), base(), []).ok).toBe(false);
  });
  it('rejects a second claim, a different lock, a second signer, a huge priority fee', () => {
    const ixs = claimInstructions(base());
    expect(validateClaim(attack([...ixs, ixs[ixs.length - 1]!]), base(), [])).toEqual({ ok: false, reason: 'claim count' });
    const other = claimInstructions(base({ lock: { ...lock, lockId: 6n } }));
    expect(validateClaim(attack(other), base(), [])).toEqual({ ok: false, reason: 'claim accounts' });
    const extra = Keypair.generate().publicKey;
    const two = claimInstructions(base());
    two.push(new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [{ pubkey: extra, isSigner: true, isWritable: false }], data: Buffer.from([9]) }));
    expect(validateClaim(attack(two), base(), []).ok).toBe(false);
    const pricey = claimInstructions(base({ cuPrice: 1e12 }));
    expect(validateClaim(attack(pricey), base(), [])).toEqual({ ok: false, reason: 'cu price' });
  });
  it('rejects a different payer and a stale blockhash', () => {
    const it = base();
    expect(validateClaim(attack(claimInstructions(it), Keypair.generate().publicKey), it, []).ok).toBe(false);
    expect(validateClaim(compileClaim(base({ blockhash: '11111111111111111111111111111111' }), []).serialize(), it, [])).toEqual({ ok: false, reason: 'blockhash' });
  });
});
