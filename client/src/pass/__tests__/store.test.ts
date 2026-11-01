import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { PendingStore, newRequestId, type KV, type PendingRecord } from '../pending';
import { base58, sigToB58 } from '../sig';
import { firstFreeLockId, verifyLockAccount, verifyVault } from '../reader';
import { receiptFromCreatingTx } from '../receipt';
import { compile } from '../txbuilder';
import { lockPda, ata } from '../fridge';
import { DISC, FRIDGE_PROGRAM, PASS_MINT, TOKEN_2022_PROGRAM } from '../constants';
import { hexBytes, u64le, bytesToB64 } from '../bytes';
import { WALLET, NOW, intent } from './fixtures';

class MemKV implements KV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }
const rec = (over: Partial<PendingRecord> = {}): PendingRecord => ({
  requestId: newRequestId(), wallet: WALLET, mint: PASS_MINT, amount: '1', amountInLamports: '10000000', lockId: 1,
  lockPda: 'x', intendedUnlockAt: 0, createdAt: Date.now(), updatedAt: Date.now(), transport: 'mock', mode: 'single',
  state: 'awaiting-wallet', signatures: [], blockhash: 'b', lastValidBlockHeight: 0, ...over,
});

describe('pending store', () => {
  it('writes synchronously and reads back', () => {
    const s = new PendingStore(new MemKV());
    const r = rec();
    s.put(r);
    expect(s.open(WALLET).map((x) => x.requestId)).toEqual([r.requestId]);
    s.update(r.requestId, { state: 'confirmed' });
    expect(s.open(WALLET)).toEqual([]);
    expect(s.reservedIds(WALLET)).toEqual([1]);
  });
  it('throws when storage silently drops writes', () => {
    const kv: KV = { getItem: () => null, setItem: () => {} };
    expect(() => new PendingStore(kv).put(rec())).toThrow();
  });
  it('throws when storage throws (quota / private mode)', () => {
    const kv: KV = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => new PendingStore(kv).put(rec())).toThrow();
  });
  it('reserves open ids, frees old confirmed ones, keeps at most 20', () => {
    const s = new PendingStore(new MemKV());
    s.put(rec({ lockId: 2, state: 'unknown' }));
    s.put(rec({ lockId: 3, state: 'confirmed', updatedAt: Date.now() - 2 * 3_600_000 }));
    s.put(rec({ lockId: 4, state: 'declined' }));
    expect(s.reservedIds(WALLET).sort()).toEqual([2]);
    for (let i = 0; i < 30; i++) s.put(rec({ createdAt: Date.now() + i }));
    expect(s.all().length).toBe(20);
  });
  it('corrupt storage reads as empty', () => {
    const kv = new MemKV(); kv.setItem('sas.pass.pending.v1', '{not json');
    expect(new PendingStore(kv).all()).toEqual([]);
  });
  it('request ids are 24 hex chars and unique', () => {
    const a = newRequestId(); expect(a).toMatch(/^[0-9a-f]{24}$/); expect(newRequestId()).not.toBe(a);
  });
});

describe('base58 / signatures', () => {
  it('known vectors', () => {
    expect(base58(new Uint8Array(32))).toBe('11111111111111111111111111111111');
    expect(base58(new PublicKey(WALLET).toBytes())).toBe(WALLET);
    expect(base58(Uint8Array.from([0, 0, 1]))).toBe('112');
  });
  it('signature must be 64 bytes', () => {
    expect(() => sigToB58(new Uint8Array(63))).toThrow();
    expect(sigToB58(new Uint8Array(64)).length).toBeGreaterThan(40);
  });
});

describe('lock ids', () => {
  it('first free id skips used and reserved; null when full', () => {
    expect(firstFreeLockId(new Set([1, 2]), [3])).toBe(4);
    expect(firstFreeLockId(new Set(Array.from({ length: 64 }, (_, i) => i + 1)), [])).toBeNull();
  });
});

describe('on-chain account verification', () => {
  const w = new PublicKey(WALLET);
  const m = new PublicKey(PASS_MINT);
  const [pda, bump] = lockPda(w, m, 5n);
  const lockData = (o: { amount?: bigint; bump?: number; id?: bigint; mint?: PublicKey; created?: bigint; unlock?: bigint } = {}) => {
    const d = new Uint8Array(105);
    d.set(hexBytes(DISC.lockAccount), 0); d.set(w.toBytes(), 8); d.set((o.mint ?? m).toBytes(), 40);
    d.set(u64le(o.amount ?? 10n), 72); d.set(u64le(o.created ?? 100n), 80); d.set(u64le(o.unlock ?? 86_500n), 88);
    d[96] = o.bump ?? bump; d.set(u64le(o.id ?? 5n), 97);
    return { owner: FRIDGE_PROGRAM, lamports: 1, executable: false, data: [bytesToB64(d), 'base64'] as [string, 'base64'] };
  };
  it('accepts the canonical lock', () => expect(verifyLockAccount(pda.toBase58(), lockData(), w)).not.toBeNull());
  it('rejects wrong owner, address, bump, mint, zero amount, bad times', () => {
    expect(verifyLockAccount(pda.toBase58(), { ...lockData(), owner: TOKEN_2022_PROGRAM }, w)).toBeNull();
    expect(verifyLockAccount(lockPda(w, m, 6n)[0].toBase58(), lockData(), w)).toBeNull();
    expect(verifyLockAccount(pda.toBase58(), lockData({ bump: (bump + 1) % 256 }), w)).toBeNull();
    expect(verifyLockAccount(pda.toBase58(), lockData({ mint: new PublicKey(FRIDGE_PROGRAM) }), w)).toBeNull();
    expect(verifyLockAccount(pda.toBase58(), lockData({ amount: 0n }), w)).toBeNull();
    expect(verifyLockAccount(pda.toBase58(), lockData({ unlock: 50n }), w)).toBeNull();
    expect(verifyLockAccount(pda.toBase58(), lockData(), new PublicKey(FRIDGE_PROGRAM))).toBeNull();
  });
  it('vault must be the Token-2022 pass-token account owned by the lock holding ≥ amount', () => {
    const v = (owner: PublicKey, amount: bigint, state = 1) => {
      const d = new Uint8Array(170); d.set(m.toBytes(), 0); d.set(owner.toBytes(), 32); d.set(u64le(amount), 64); d[108] = state;
      return { owner: TOKEN_2022_PROGRAM, lamports: 1, executable: false, data: [bytesToB64(d), 'base64'] as [string, 'base64'] };
    };
    expect(verifyVault(v(pda, 10n), pda, 10n)).toBe(10n);
    expect(verifyVault(v(pda, 9n), pda, 10n)).toBeNull();
    expect(verifyVault(v(w, 10n), pda, 10n)).toBeNull();
    expect(verifyVault(v(pda, 10n, 2), pda, 10n)).toBeNull();
    expect(ata(pda, m, TOKEN_2022_PROGRAM)).toBeTruthy();
  });
});

describe('receipt from the creating transaction', () => {
  const it0 = intent();
  const [pda, bump] = lockPda(new PublicKey(WALLET), new PublicKey(PASS_MINT), it0.lockId);
  const vl = (amount: bigint) => ({
    address: pda.toBase58(), vault: 'v', vaultAmount: amount, lamports: 1, depositor: new PublicKey(WALLET), mint: new PublicKey(PASS_MINT),
    amount, createdAt: BigInt(NOW), unlockAt: it0.unlockAt, bump, lockId: it0.lockId,
  });
  it('accepts the single swap+lock transaction', () => {
    expect(receiptFromCreatingTx(compile('single', it0).serialize(), vl(it0.minOut), WALLET)).toBe(true);
  });
  it('rejects a lock-only transaction, another amount, another wallet', () => {
    expect(receiptFromCreatingTx(compile('lock', it0).serialize(), vl(it0.minOut), WALLET)).toBe(false);
    expect(receiptFromCreatingTx(compile('single', it0).serialize(), vl(it0.minOut - 1n), WALLET)).toBe(false);
    expect(receiptFromCreatingTx(compile('single', it0).serialize(), vl(it0.minOut), '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(false);
  });
  it('rejects a swap below 0.01 SOL', () => {
    const small = intent({ amountIn: 9_000_000n });
    expect(receiptFromCreatingTx(compile('single', small).serialize(), vl(small.minOut), WALLET)).toBe(false);
  });
});
