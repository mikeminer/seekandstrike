import { describe, expect, it } from 'vitest';
import { PROOF_TTL_MS, challengeMessage, parseChallengeMessage } from '@shared/passProof';
import { parseClientMessage } from '@shared/protocol';
import { FLOOR_RAW } from '@pass/constants';
import { AccessGate, PassRegistry, RpcPassVerifier, passRpcFromUrl, verifyWalletSignature, type PassVerifier } from './access';
import { FakeChain, dayLock, newWallet } from './testChain';

const nowS = (): number => Math.floor(Date.now() / 1000);

function setup(opts: { now?: () => number } = {}) {
  const chain = new FakeChain();
  const verifier = new RpcPassVerifier(chain, opts.now ? { now: opts.now } : {});
  const gate = new AccessGate({ roomId: 'room-1', verifier, ...(opts.now ? { now: opts.now } : {}) });
  return { chain, verifier, gate };
}

describe('challenge text', () => {
  const c = { wallet: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', room: 'abc123', nonce: 'a'.repeat(32), iat: 1_793_000_000_000, exp: 1_793_000_060_000 };
  it('round-trips and says plainly that it is not a transaction', () => {
    const text = challengeMessage(c);
    expect(parseChallengeMessage(text)).toEqual(c);
    expect(text).toContain('not a transaction');
  });
  it('rejects anything that is not exactly the template', () => {
    const text = challengeMessage(c);
    expect(parseChallengeMessage(text + '\n')).toBeNull();
    expect(parseChallengeMessage(text.replace('Wallet:', 'Wallet :'))).toBeNull();
    expect(parseChallengeMessage(text.replace('seekandstrike.it', 'evil.example'))).toBeNull();
    expect(parseChallengeMessage(text.replace(c.nonce, 'zz'))).toBeNull();
    expect(parseChallengeMessage('x'.repeat(5000))).toBeNull();
    expect(parseChallengeMessage('')).toBeNull();
  });
});

describe('protocol parsing for the proof', () => {
  it('accepts a wallet in hello and a 64-byte base64 signature in auth, nothing else', () => {
    const w = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 2, wallet: w }))).toEqual({ t: 'hello', v: 2, wallet: w });
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 2, wallet: 'nope' }))).toEqual({ t: 'hello', v: 2 });
    const sig = btoa(String.fromCharCode(...new Uint8Array(64).fill(7)));
    expect(parseClientMessage(JSON.stringify({ t: 'auth', sig }))).toEqual({ t: 'auth', sig });
    expect(parseClientMessage(JSON.stringify({ t: 'auth', sig: sig.slice(4) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'auth' }))).toBeNull();
  });
});

describe('wallet signature', () => {
  it('accepts the owner and nobody else', async () => {
    const a = await newWallet(), b = await newWallet();
    const sig = await a.sign('hello');
    expect(await verifyWalletSignature(a.address, 'hello', sig)).toBe(true);
    expect(await verifyWalletSignature(a.address, 'hellO', sig)).toBe(false);
    expect(await verifyWalletSignature(b.address, 'hello', sig)).toBe(false);
    expect(await verifyWalletSignature(a.address, 'hello', 'AAAA')).toBe(false);
    expect(await verifyWalletSignature('not a wallet', 'hello', sig)).toBe(false);
  });
});

describe('access gate', () => {
  it('admits a wallet that proves ownership and holds a Daily Pass, until the lock ends', async () => {
    const { chain, gate } = setup();
    const w = await newWallet();
    const spec = dayLock(nowS());
    chain.addLock(w.address, spec);
    const ch = gate.begin(w.address)!;
    const v = await gate.finish(ch.pending, await w.sign(ch.message));
    expect(v).toEqual({ ok: true, wallet: w.address, expiresAt: spec.unlockAt });
  });

  it('refuses a signature made by another key (someone else\'s pass cannot be borrowed)', async () => {
    const { chain, gate } = setup();
    const owner = await newWallet(), thief = await newWallet();
    chain.addLock(owner.address, dayLock(nowS()));
    const ch = gate.begin(owner.address)!;
    expect(await gate.finish(ch.pending, await thief.sign(ch.message))).toEqual({ ok: false, error: 'proof_invalid' });
  });

  it('refuses a signature over another challenge (no replay) and over a challenge for another room', async () => {
    const { chain, gate } = setup();
    const w = await newWallet();
    chain.addLock(w.address, dayLock(nowS()));
    const first = gate.begin(w.address)!;
    const second = gate.begin(w.address)!;
    expect(first.pending.nonce).not.toBe(second.pending.nonce);
    expect(await gate.finish(second.pending, await w.sign(first.message))).toEqual({ ok: false, error: 'proof_invalid' });
    const other = new AccessGate({ roomId: 'room-2', verifier: setup().verifier });
    const elsewhere = other.begin(w.address)!;
    expect(await gate.finish(first.pending, await w.sign(elsewhere.message))).toEqual({ ok: false, error: 'proof_invalid' });
  });

  it('refuses an expired challenge', async () => {
    let t = 1_800_000_000_000;
    const { chain, gate } = setup({ now: () => t });
    const w = await newWallet();
    chain.addLock(w.address, dayLock(t / 1000));
    const ch = gate.begin(w.address)!;
    const sig = await w.sign(ch.message);
    t += PROOF_TTL_MS + 1;
    expect(await gate.finish(ch.pending, sig)).toEqual({ ok: false, error: 'proof_expired' });
  });

  it('a valid signature without a pass is "pass_required" (no lock, too small, ended, or somebody else\'s)', async () => {
    const { chain, gate } = setup();
    const none = await newWallet(), small = await newWallet(), ended = await newWallet(), other = await newWallet(), borrower = await newWallet();
    chain.addLock(small.address, dayLock(nowS(), { amount: FLOOR_RAW - 1n }));
    chain.addLock(ended.address, { createdAt: nowS() - 90_000, unlockAt: nowS() - 3_600, amount: FLOOR_RAW });
    chain.addLock(other.address, dayLock(nowS()));
    for (const w of [none, small, ended, borrower]) {
      const ch = gate.begin(w.address)!;
      expect(await gate.finish(ch.pending, await w.sign(ch.message))).toEqual({ ok: false, error: 'pass_required' });
    }
  });

  it('a lock whose depositor is someone else does not count, even if the node returns it for this wallet', async () => {
    const { chain, gate } = setup();
    const w = await newWallet(), owner = await newWallet();
    chain.addLock(w.address, dayLock(nowS(), { depositor: owner.address }));
    const ch = gate.begin(w.address)!;
    expect(await gate.finish(ch.pending, await w.sign(ch.message))).toEqual({ ok: false, error: 'pass_required' });
  });

  it('a lock with an empty or missing vault does not count', async () => {
    const { chain, gate } = setup();
    const a = await newWallet(), b = await newWallet();
    chain.addLock(a.address, dayLock(nowS(), { vault: 'empty' }));
    chain.addLock(b.address, dayLock(nowS(), { vault: 'missing' }));
    for (const w of [a, b]) {
      const ch = gate.begin(w.address)!;
      expect(await gate.finish(ch.pending, await w.sign(ch.message))).toEqual({ ok: false, error: 'pass_required' });
    }
  });

  it('an unreachable node is "pass_unavailable", never "you have no pass", and is not remembered', async () => {
    const { chain, gate } = setup();
    const w = await newWallet();
    chain.addLock(w.address, dayLock(nowS()));
    chain.down = true;
    const ch = gate.begin(w.address)!;
    expect(await gate.finish(ch.pending, await w.sign(ch.message))).toEqual({ ok: false, error: 'pass_unavailable' });
    chain.down = false;
    const again = gate.begin(w.address)!;
    expect((await gate.finish(again.pending, await w.sign(again.message))).ok).toBe(true);
  });

  it('rejects addresses that are not wallets', () => {
    const { gate } = setup();
    expect(gate.begin(undefined)).toBeNull();
    expect(gate.begin('hello')).toBeNull();
    expect(gate.begin('1'.repeat(44))).toBeNull(); // right alphabet and length, but not a valid 32-byte key
  });
});

describe('pass verifier', () => {
  it('caches answers so a quick re-join costs no chain read, and a missing pass is remembered briefly', async () => {
    const { chain, verifier } = setup();
    const yes = await newWallet(), no = await newWallet();
    chain.addLock(yes.address, dayLock(nowS()));
    expect((await verifier.check(yes.address)).ok).toBe(true);
    const calls = chain.calls.length;
    expect((await verifier.check(yes.address)).ok).toBe(true);
    expect(chain.calls.length).toBe(calls);
    expect((await verifier.check(no.address)).ok).toBe(false);
    const callsNo = chain.calls.length;
    expect((await verifier.check(no.address)).ok).toBe(false);
    expect(chain.calls.length).toBe(callsNo);
  });

  it('concurrent checks of one wallet share one read; too many different ones are refused as unavailable', async () => {
    const { chain, verifier } = setup();
    chain.delayMs = 30;
    const w = await newWallet();
    chain.addLock(w.address, dayLock(nowS()));
    const same = await Promise.all([verifier.check(w.address), verifier.check(w.address), verifier.check(w.address)]);
    expect(same.every((r) => r.ok)).toBe(true);
    expect(chain.calls.filter((c) => c === 'getProgramAccounts').length).toBe(1);

    const wallets = await Promise.all(Array.from({ length: 7 }, () => newWallet()));
    const results = await Promise.all(wallets.map((x) => verifier.check(x.address)));
    const refused = results.filter((r) => !r.ok && r.reason === 'unavailable').length;
    expect(refused).toBe(3); // 4 concurrent reads allowed
  });

  it('a cached pass stops being served once its lock has ended', async () => {
    let t = Date.now();
    const chain = new FakeChain();
    const verifier = new RpcPassVerifier(chain, { now: () => t, positiveTtlMs: 10 * 60_000 });
    const w = await newWallet();
    const spec = dayLock(Math.floor(t / 1000));
    chain.addLock(w.address, spec);
    expect((await verifier.check(w.address)).ok).toBe(true);
    t = (spec.unlockAt + 5) * 1000;
    expect((await verifier.check(w.address)).ok).toBe(false);
  });
});

describe('RPC url policy', () => {
  it('https anywhere, plain http only on loopback', () => {
    expect(passRpcFromUrl('https://rpc.example.com/key')).not.toBeNull();
    expect(passRpcFromUrl('http://127.0.0.1:8899')).not.toBeNull();
    expect(passRpcFromUrl('http://localhost:8899')).not.toBeNull();
    expect(passRpcFromUrl('http://rpc.example.com')).toBeNull();
    expect(passRpcFromUrl('ftp://x')).toBeNull();
    expect(passRpcFromUrl('')).toBeNull();
    expect(passRpcFromUrl(undefined)).toBeNull();
  });
});

describe('pass registry', () => {
  it('tracks one seat per wallet, resumability and expiry', () => {
    const r = new PassRegistry();
    r.grant(3, 'tok-a', 'W1', 2_000);
    expect(r.holder('W1')).toEqual({ seat: 3, token: 'tok-a' });
    expect(r.resumable('tok-a', 1_999_000)).toBe(true);
    expect(r.resumable('tok-a', 2_000_000)).toBe(false);
    expect(r.resumable('tok-zzz', 0)).toBe(false);
    expect(r.expired(1_000_000)).toEqual([]);
    expect(r.expired(2_000_000)).toEqual([{ seat: 3, token: 'tok-a' }]);
    r.grant(5, 'tok-b', 'W1', 9_000); // same wallet again: the registry follows the latest seat
    expect(r.holder('W1')).toEqual({ seat: 5, token: 'tok-b' });
    r.drop(3);
    expect(r.holder('W1')).toEqual({ seat: 5, token: 'tok-b' });
    r.drop(5);
    expect(r.holder('W1')).toBeNull();
    expect(r.size).toBe(0);
  });
});

describe('a verifier can be anything with check()', () => {
  it('the gate only depends on the PassVerifier interface', async () => {
    const w = await newWallet();
    const v: PassVerifier = { check: async () => ({ ok: true, expiresAt: 42 }) };
    const gate = new AccessGate({ roomId: 'r', verifier: v });
    const ch = gate.begin(w.address)!;
    expect(await gate.finish(ch.pending, await w.sign(ch.message))).toEqual({ ok: true, wallet: w.address, expiresAt: 42 });
  });
});
