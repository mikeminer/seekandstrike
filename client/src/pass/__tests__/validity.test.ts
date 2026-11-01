import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { evaluatePass, trustedNow } from '../validity';
import type { LockSnapshot, VerifiedLock } from '../reader';
import { FLOOR_RAW, PASS_MINT } from '../constants';
import { lockPda } from '../fridge';
import { WALLET } from './fixtures';

const NOW = 1_793_000_000;
const w = new PublicKey(WALLET);
const m = new PublicKey(PASS_MINT);
function lock(id: number, amount: bigint, createdAt: number, unlockAt: number, wallet = w): VerifiedLock {
  const [pda, bump] = lockPda(wallet, m, BigInt(id));
  return { address: pda.toBase58(), vault: 'v', vaultAmount: amount, lamports: 1, depositor: wallet, mint: m, amount, createdAt: BigInt(createdAt), unlockAt: BigInt(unlockAt), bump, lockId: BigInt(id) };
}
const snap = (locks: VerifiedLock[], ts = NOW, partial = false): LockSnapshot => ({ ts, locks, partial, usedIds: new Set() });
const none = new Set<string>();

describe('pass validity (brief §9.5)', () => {
  it('floor deposit, 1 day, active', () => {
    const s = evaluatePass(snap([lock(1, FLOOR_RAW, NOW - 100, NOW - 100 + 86_400)]), WALLET, NOW, none);
    expect(s.state).toBe('active');
    if (s.state === 'active') { expect(s.via).toBe('floor'); expect(s.expiresAt).toBe(NOW - 100 + 86_400); }
  });
  it('below floor without receipt → none (pending receipt)', () => {
    const l = lock(1, FLOOR_RAW - 1n, NOW - 100, NOW + 86_300);
    const s = evaluatePass(snap([l]), WALLET, NOW, none);
    expect(s.state).toBe('none');
    if (s.state === 'none') expect(s.pendingReceipt.map((x) => x.address)).toEqual([l.address]);
  });
  it('below floor with a verified receipt → active via receipt', () => {
    const l = lock(1, 5n, NOW - 100, NOW + 86_300);
    const s = evaluatePass(snap([l]), WALLET, NOW, new Set([l.address]));
    expect(s.state === 'active' && s.via).toBe('receipt');
  });
  it('never sums deposits', () => {
    const half = FLOOR_RAW / 2n;
    const s = evaluatePass(snap([lock(1, half, NOW - 10, NOW + 86_390), lock(2, half, NOW - 10, NOW + 86_390)]), WALLET, NOW, none);
    expect(s.state).toBe('none');
  });
  it('expired → none, listed as expired', () => {
    const l = lock(1, FLOOR_RAW, NOW - 90_000, NOW - 3_600);
    const s = evaluatePass(snap([l]), WALLET, NOW, none);
    expect(s.state).toBe('none');
    if (s.state === 'none') expect(s.expired.length).toBe(1);
  });
  it('too short a duration does not count (≥ 86400 − 3600)', () => {
    expect(evaluatePass(snap([lock(1, FLOOR_RAW, NOW - 10, NOW - 10 + 82_799)]), WALLET, NOW, none).state).toBe('none');
    expect(evaluatePass(snap([lock(1, FLOOR_RAW, NOW - 10, NOW - 10 + 82_800)]), WALLET, NOW, none).state).toBe('active');
  });
  it('another wallet\'s deposit fails closed (the reader never returns one)', () => {
    const other = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    expect(() => evaluatePass(snap([lock(1, FLOOR_RAW, NOW - 10, NOW + 86_390, other)]), WALLET, NOW, none)).toThrow();
  });
  it('stale evidence (> 90 s) fails closed', () => {
    expect(() => evaluatePass(snap([lock(1, FLOOR_RAW, NOW - 10, NOW + 86_390)], NOW - 91), WALLET, NOW, none)).toThrow();
  });
  it('a slow device clock cannot predate on-chain createdAt', () => {
    const s = snap([lock(1, FLOOR_RAW, NOW, NOW + 86_400)], NOW);
    expect(trustedNow(s, NOW - 500)).toBe(NOW);
    expect(() => evaluatePass(s, WALLET, NOW - 500, none)).not.toThrow();
  });
});
