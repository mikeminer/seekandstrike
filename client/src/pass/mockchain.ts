import './polyfill';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { DISC, FRIDGE_PROGRAM, LOCK_ACCOUNT_SIZE, PASS_MINT, TOKEN_2022_PROGRAM } from './constants';
import { ata, decodeLock, lockPda } from './fridge';
import { b64ToBytes, bytesToB64, concat, eqBytes, hexBytes, i64le, readI64, readU64, u64le } from './bytes';
import { getRent, simulate, type AccountInfoB64, type Rpc, type SimResult } from './rpc';

/**
 * DEV / test only (never in release builds): a read-only overlay over a real RPC. Reads go to
 * mainnet unchanged; when the mock wallet "sends", each transaction is SIMULATED (sigVerify off)
 * and the simulated post-state of the pass accounts is overlaid on later reads, with a fake
 * confirmed signature. Nothing is ever signed or broadcast.
 */
export class MockChainRpc implements Rpc {
  readonly overlay = new Map<string, AccountInfoB64 | null>();
  readonly statuses = new Map<string, { err: unknown }>();
  heightBump = 0;
  constructor(readonly inner: Rpc) {}
  get label(): string { return `mock+${this.inner.label}`; }

  /** Apply one "sent" transaction: simulate it, overlay the pass/vault/ATA post-state. */
  async apply(tx: VersionedTransaction, sig: string, wallet: string): Promise<void> {
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const w = new PublicKey(wallet);
    const userAta = ata(w, new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const watch = [...new Set([wallet, userAta, ...keys.filter((k) => k !== wallet)])].slice(0, 20);
    const sim = (await this.localLock(tx, watch)) ?? (await simulate(this.inner, bytesToB64(tx.serialize()), watch, true));
    if (sim.err) { this.statuses.set(sig, { err: sim.err }); return; }
    watch.forEach((k, i) => {
      const a = sim.accounts?.[i] ?? null;
      const before = this.overlay.get(k);
      if (a || before !== undefined) this.overlay.set(k, a);
    });
    // Accounts closed by the transaction come back as null with lamports 0.
    for (const [k, v] of this.overlay) if (v && v.lamports === 0) this.overlay.set(k, null);
    this.statuses.set(sig, { err: null });
  }

  /**
   * A pass-only transaction whose pass token only exists in the overlay (a mocked swap "landed" just
   * before) cannot be simulated by a real node. It is modelled locally from the Fridge layout:
   * tokens move from the player's account to the pass vault and the pass record is written.
   * The real pass-only instruction is simulated on mainnet separately (sim suite, real holder).
   */
  private async localLock(tx: VersionedTransaction, addresses: string[]): Promise<SimResult | null> {
    const m = tx.message;
    const keys = m.staticAccountKeys.map((k) => k.toBase58());
    const ixs = m.compiledInstructions;
    const lockIx = ixs.find((ix) => keys[ix.programIdIndex] === FRIDGE_PROGRAM);
    if (!lockIx || ixs.some((ix) => !['ComputeBudget111111111111111111111111111111', FRIDGE_PROGRAM].includes(keys[ix.programIdIndex]!))) return null;
    const data = lockIx.data;
    if (data.length !== 32 || !eqBytes(data.subarray(0, 8), hexBytes(DISC.createLock))) return null;
    const wallet = keys[0]!;
    const userAta = ata(new PublicKey(wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const src = this.overlay.get(userAta);
    if (!src) return null; // no overlaid pass token: let the real node simulate it
    const amount = readU64(data, 8), unlockAt = readI64(data, 16), lockId = readU64(data, 24);
    const srcData = b64ToBytes(src.data[0]);
    const have = readU64(srcData, 64);
    if (have < amount) return { err: { InstructionError: [ixs.indexOf(lockIx), { Custom: 1 }] }, logs: ['mock: insufficient funds'], accounts: null };
    const [lock, bump] = lockPda(new PublicKey(wallet), new PublicKey(PASS_MINT), lockId);
    const vault = ata(lock, new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const lockData = concat(hexBytes(DISC.lockAccount), new PublicKey(wallet).toBytes(), new PublicKey(PASS_MINT).toBytes(),
      u64le(amount), i64le(now), i64le(unlockAt), new Uint8Array([bump]), u64le(lockId));
    if (lockData.length !== LOCK_ACCOUNT_SIZE) throw new Error('lock layout');
    const newSrc = srcData.slice(); newSrc.set(u64le(have - amount), 64);
    const vaultData = srcData.slice(); vaultData.set(new PublicKey(PASS_MINT).toBytes(), 0); vaultData.set(lock.toBytes(), 32); vaultData.set(u64le(amount), 64);
    const [lockRent, vaultRent] = await Promise.all([getRent(this.inner, LOCK_ACCOUNT_SIZE), getRent(this.inner, srcData.length)]);
    const walletInfo = this.overlay.get(wallet) ?? (await this.inner.call<{ value: (AccountInfoB64 | null)[] }>('getMultipleAccounts', [[wallet], { encoding: 'base64', commitment: 'confirmed' }])).value[0] ?? null;
    const fee = 5000n;
    const state = new Map<string, AccountInfoB64 | null>([
      [userAta, { ...src, data: [bytesToB64(newSrc), 'base64'] }],
      [lock.toBase58(), { lamports: Number(lockRent), owner: FRIDGE_PROGRAM, data: [bytesToB64(lockData), 'base64'], executable: false, space: LOCK_ACCOUNT_SIZE }],
      [vault, { lamports: Number(vaultRent), owner: TOKEN_2022_PROGRAM, data: [bytesToB64(vaultData), 'base64'], executable: false, space: vaultData.length }],
    ]);
    if (walletInfo) state.set(wallet, { ...walletInfo, lamports: walletInfo.lamports - Number(lockRent + vaultRent + fee) });
    return { err: null, logs: ['mock: pass step modelled locally'], unitsConsumed: 0, accounts: addresses.map((a) => (state.has(a) ? state.get(a)! : this.overlay.get(a) ?? null)) };
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    if (method === 'sendTransaction') throw new Error('mock chain never broadcasts');
    if (method === 'simulateTransaction') {
      const [b64, cfg] = params as [string, { accounts?: { addresses: string[] } }];
      const local = await this.localLock(VersionedTransaction.deserialize(b64ToBytes(b64)), cfg?.accounts?.addresses ?? []);
      if (local) return { context: { slot: 0 }, value: local } as T;
    }
    if (method === 'getMultipleAccounts') {
      const keys = params[0] as string[];
      const missing = keys.filter((k) => !this.overlay.has(k));
      const real = missing.length ? await this.inner.call<{ value: (AccountInfoB64 | null)[] }>(method, [missing, ...params.slice(1)]) : { value: [] };
      const byKey = new Map(missing.map((k, i) => [k, real.value[i] ?? null] as const));
      return { context: { slot: 0 }, value: keys.map((k) => (this.overlay.has(k) ? this.overlay.get(k)! : byKey.get(k)!)) } as T;
    }
    if (method === 'getBalance') {
      const k = params[0] as string;
      if (this.overlay.has(k)) return { context: { slot: 0 }, value: this.overlay.get(k)?.lamports ?? 0 } as T;
    }
    if (method === 'getProgramAccounts') {
      const real = await this.inner.call<{ pubkey: string; account: AccountInfoB64 }[]>(method, params);
      const cfg = params[1] as { filters?: { memcmp?: { offset: number; bytes: string } }[] };
      const depositor = cfg.filters?.find((f) => f.memcmp?.offset === 8)?.memcmp?.bytes;
      const out = real.filter((r) => !this.overlay.has(r.pubkey) || this.overlay.get(r.pubkey));
      for (const [k, v] of this.overlay) {
        if (!v || out.some((r) => r.pubkey === k)) continue;
        const l = v.data[0] ? decodeLock(b64ToBytes(v.data[0])) : null;
        if (l && l.depositor.toBase58() === depositor) out.push({ pubkey: k, account: v });
      }
      return out as T;
    }
    if (method === 'getSignatureStatuses') {
      const sigs = params[0] as string[];
      const own = sigs.map((s) => this.statuses.get(s));
      if (own.every((x) => x !== undefined)) {
        return { context: { slot: 0 }, value: own.map((x) => ({ slot: 1, confirmations: null, err: x!.err, confirmationStatus: 'confirmed' })) } as T;
      }
      const real = await this.inner.call<{ value: unknown[] }>(method, params);
      return { context: { slot: 0 }, value: sigs.map((s, i) => { const x = this.statuses.get(s); return x ? { slot: 1, confirmations: null, err: x.err, confirmationStatus: 'confirmed' } : real.value[i] ?? null; }) } as T;
    }
    if (method === 'getBlockHeight') {
      return ((await this.inner.call<number>(method, params)) + this.heightBump) as T;
    }
    if (method === 'getSignaturesForAddress') return [] as T;
    return this.inner.call<T>(method, params);
  }
}
