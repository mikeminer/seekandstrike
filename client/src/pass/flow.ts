import './polyfill';
import { PublicKey, type VersionedTransaction } from '@solana/web3.js';
import {
  COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_LIMIT_LOCK_ONLY, DAMM_POOL, DAMM_PROGRAM, DEFAULT_SLIPPAGE_BPS, LOCK_ACCOUNT_SIZE, MAX_PRIORITY_MICROLAMPORTS,
  MAX_LOCK_ID, NOMINAL_LAMPORTS, PASS_SECONDS, PENDING_RECONCILE_MS, QUOTE_REFRESH_MS, SOL_FEE_RESERVE_LAMPORTS,
  PASS_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT,
} from './constants';
import { ata, decodeLock, lockPda } from './fridge';
import { b64ToBytes, bytesToB64 } from './bytes';
import { computeBuffer, nextSlippage, type BufferResult } from './math';
import { resolveRoute, type DammRoute } from './meteora';
import { QuoteError, simQuoter, tokenAmount } from './quote';
import { firstFreeLockId, readLocks, type LockSnapshot, type VerifiedLock } from './reader';
import { verifyReceipt } from './receipt';
import {
  getBalance, getBlockHeight, getOwnTransaction, getLatestBlockhash, getMultipleAccounts, getPriorityFee, getRent, getSignatureStatuses,
  RpcError, sendRawTransaction, simulate, type Rpc,
} from './rpc';
import { compile, plan, type PurchaseIntent, type TxKind } from './txbuilder';
import { decodeTransaction, validateTransaction } from './validator';
import { nativeValidate } from './nativeValidator';
import { evaluatePass, type PassStatus } from './validity';
import { PendingStore, newRequestId, type PendingRecord } from './pending';
import { classifyChainError, type ChainFailure } from './errors';
import type { WalletFailure, WalletSession } from './wallet';
import { buildClaim, type FetchJson } from './claim';

export type ReleaseOutcome =
  | { ok: true; returnedLamports: bigint }
  | { ok: false; reason: 'waiting' | 'not-ended' | 'unknown' | 'busy' }
  | { ok: false; reason: 'error'; error: FlowError };

/** System account rent-exempt minimum (0 data bytes): the wallet must stay above it. */
const WALLET_RENT_MIN = 890_880n;
const SIG_FEE = 5_000n;

export interface Costs {
  /** Rent for the pass record + its token account (returned when the pass ends). */
  returned: bigint;
  /** One-time: the player's pass-token account (first purchase only). */
  firstTimeRent: bigint;
  /** One-time: the shared buyback token account, when it does not exist yet. */
  buybackRent: bigint;
  /** One-time: the exchange's per-player volume record (created on the first swap ever). */
  accumulatorRent: bigint;
  /** Temporary wSOL account rent (opened and closed inside the transaction). */
  wsolRent: bigint;
  /** Part of `returned` that is the lock's token account (internal bookkeeping for the exact re-measure). */
  returnedVault?: bigint;
}

export interface Review {
  buffer: BufferResult;
  /** Exact lamports leaving the wallet (A + rents + network fees). */
  totalLamports: bigint;
  feeLamports: bigint;
  costs: Costs;
  /** (A − N)/N in basis points: the "includes X% margin" line. */
  marginBps: number;
  mode: 'single' | 'two';
  firstTime: boolean;
  balance: bigint;
  quotedAt: number;
  /** Priority fee (µlamports/CU) the total was computed with; the signed build uses the same. */
  cuPrice: number;
  /** Slippage was raised after a market move: the player must tap again. */
  retried: boolean;
}

export type FlowError =
  | { kind: 'wallet'; failure: WalletFailure }
  | { kind: 'chain'; failure: ChainFailure }
  | { kind: 'rpc' }
  | { kind: 'storage' }
  | { kind: 'validation'; reason: string }
  | { kind: 'ids-full' };

export type FlowView =
  | { step: 'disconnected' }
  | { step: 'connecting' }
  | { step: 'loading' }
  | { step: 'active'; status: Extract<PassStatus, { state: 'active' }>; expired: VerifiedLock[] }
  | { step: 'offer'; expired: VerifiedLock[]; partial: boolean }
  | { step: 'checking' }
  | { step: 'review'; review: Review }
  | { step: 'insufficient'; needLamports: bigint; balance: bigint }
  | { step: 'market' }
  | { step: 'route-unavailable' }
  | { step: 'preparing' }
  | { step: 'wallet' }
  | { step: 'confirming'; rec: PendingRecord }
  | { step: 'unknown'; rec: PendingRecord }
  | { step: 'activate'; rec: PendingRecord }
  | { step: 'error'; error: FlowError; back: 'offer' | 'review' | 'disconnected' };

export interface FlowDeps {
  rpc: Rpc;
  session: WalletSession;
  store?: PendingStore;
  /** Device clock in ms (injectable for tests). */
  now?: () => number;
  /** DEV/test only: always use the two-transaction plan (exercises Activate). */
  forceTwoTx?: boolean;
}

interface Market {
  route: DammRoute;
  userAtaExists: boolean;
  wsolExists: boolean;
  preAmount: bigint;
  costs: Costs;
  balance: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PassFlow {
  view: FlowView = { step: 'disconnected' };
  status: PassStatus | null = null;
  snapshot: LockSnapshot | null = null;
  slippageBps = DEFAULT_SLIPPAGE_BPS;
  private listeners = new Set<(v: FlowView) => void>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private market: Market | null = null;
  private receiptOk = new Set<string>();
  private readonly rpc: Rpc;
  private readonly session: WalletSession;
  private readonly store: PendingStore;
  private readonly nowMs: () => number;
  private epoch = 0;
  private readonly forceTwo: boolean;

  constructor(d: FlowDeps) {
    this.rpc = d.rpc;
    this.session = d.session;
    this.store = d.store ?? new PendingStore();
    this.nowMs = d.now ?? (() => Date.now());
    this.forceTwo = d.forceTwoTx ?? false;
  }

  get wallet(): string | null { return this.session.address; }
  get hasPass(): boolean { return this.status?.state === 'active' && this.status.expiresAt > this.nowS(); }
  onChange(cb: (v: FlowView) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private nowS(): number { return Math.floor(this.nowMs() / 1000); }
  private set(v: FlowView): void {
    this.view = v;
    if (v.step !== 'review') this.stopRefresh();
    this.listeners.forEach((l) => l(v));
  }

  // ───────────────────────── 1. wallet ─────────────────────────
  async connect(adapter: Parameters<WalletSession['connect']>[0]): Promise<void> {
    this.set({ step: 'connecting' });
    const r = await this.session.connect(adapter);
    if (!r.ok) { this.set({ step: 'error', error: { kind: 'wallet', failure: r.failure }, back: 'disconnected' }); return; }
    this.receiptOk.clear();
    await this.refresh();
  }
  async disconnect(): Promise<void> {
    this.epoch++;
    await this.session.disconnect();
    this.status = null; this.snapshot = null; this.market = null;
    this.set({ step: 'disconnected' });
  }

  // ─────────────── 10. fresh pass read (+ pending reconciliation) ───────────────
  async refresh(): Promise<void> {
    const wallet = this.wallet;
    if (!wallet) { this.set({ step: 'disconnected' }); return; }
    const ep = this.epoch;
    this.set({ step: 'loading' });
    const open = this.store.open(wallet);
    if (open.length) {
      for (const rec of open) {
        const done = await this.reconcile(rec, ep);
        if (ep !== this.epoch) return;
        if (!done) return; // the reconcile view (unknown / confirming) stays on screen
      }
    }
    const act = this.activatable(wallet);
    if (act) { this.set({ step: 'activate', rec: act }); return; }
    await this.readPass(ep);
  }

  private activatable(wallet: string): PendingRecord | null {
    return this.store.forWallet(wallet).find((r) => r.swapLanded && !r.activatedBy && (r.state === 'failed' || r.state === 'expired' || r.state === 'confirmed')
      && this.nowMs() - r.createdAt < 7 * 86_400_000) ?? null;
  }

  private async readPass(ep: number): Promise<void> {
    const wallet = this.wallet!;
    const res = await readLocks(this.rpc, wallet, this.store.reservedIds(wallet));
    if (ep !== this.epoch) return;
    if (!res.ok) { this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' }); return; }
    this.snapshot = res.snapshot;
    let st: PassStatus;
    try { st = evaluatePass(res.snapshot, wallet, this.nowS(), this.receiptOk); } catch { this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' }); return; }
    if (st.state === 'none' && st.pendingReceipt.length) {
      for (const l of st.pendingReceipt) if (await verifyReceipt(this.rpc, l, wallet)) this.receiptOk.add(l.address);
      if (ep !== this.epoch) return;
      try { st = evaluatePass(res.snapshot, wallet, this.nowS(), this.receiptOk); } catch { this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' }); return; }
    }
    this.status = st;
    const expired = res.snapshot.locks.filter((l) => Number(l.unlockAt) <= this.nowS());
    if (st.state === 'active') this.set({ step: 'active', status: st, expired });
    else this.set({ step: 'offer', expired, partial: st.partial });
  }

  // ───────────────────── 2–3. checks and review ─────────────────────
  async startPurchase(slippageBps = this.slippageBps, retried = false): Promise<void> {
    const wallet = this.wallet;
    if (!wallet) return;
    if (this.store.open(wallet).length) { await this.refresh(); return; }
    this.slippageBps = slippageBps;
    const ep = this.epoch;
    this.set({ step: 'checking' });
    try {
      const m = await this.readMarket(wallet);
      if (ep !== this.epoch) return;
      if (!m) { this.set({ step: 'route-unavailable' }); return; }
      this.market = m;
      const review = await this.buildReview(m, slippageBps, retried);
      if (ep !== this.epoch) return;
      if (review === 'market') { this.set({ step: 'market' }); return; }
      if (review === 'insufficient') {
        this.set({ step: 'insufficient', needLamports: this.estimateNeed(m, NOMINAL_LAMPORTS), balance: m.balance });
        return;
      }
      const need = review.totalLamports + m.costs.wsolRent + WALLET_RENT_MIN;
      if (m.balance < need) { this.set({ step: 'insufficient', needLamports: need, balance: m.balance }); return; }
      this.set({ step: 'review', review });
      this.startRefresh();
    } catch (e) {
      if (ep !== this.epoch) return;
      this.set({ step: 'error', error: e instanceof QuoteError ? { kind: 'chain', failure: e.failure } : { kind: 'rpc' }, back: 'offer' });
    }
  }

  setSlippage(bps: number): void {
    if (this.view.step !== 'review') { this.slippageBps = bps; return; }
    void this.startPurchase(bps);
  }

  private estimateNeed(m: Market, amountIn: bigint): bigint {
    return amountIn + m.costs.returned + m.costs.firstTimeRent + m.costs.buybackRent + m.costs.accumulatorRent + m.costs.wsolRent + WALLET_RENT_MIN + SOL_FEE_RESERVE_LAMPORTS;
  }

  private async readMarket(wallet: string): Promise<Market | null> {
    const route = await resolveRoute(this.rpc);
    if (!route.ok) { if (route.reason === 'rpc') throw new RpcError('unavailable', 'route'); return null; }
    const w = new PublicKey(wallet);
    const userAta = ata(w, new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const sizeRef = route.route.tokenAVault.toBase58();
    const wsolAta = ata(w, new PublicKey(WSOL_MINT), TOKEN_PROGRAM).toBase58();
    const [userInfo, refInfo, wsolInfo] = await getMultipleAccounts(this.rpc, [userAta, sizeRef, wsolAta]);
    const t22Size = refInfo ? (refInfo.space ?? b64ToBytes(refInfo.data[0]).length) : 170;
    const [balance, lockRent, t22Rent, splRent] = await Promise.all([
      getBalance(this.rpc, wallet), getRent(this.rpc, LOCK_ACCOUNT_SIZE), getRent(this.rpc, t22Size), getRent(this.rpc, 165),
    ]);
    return {
      route: route.route, userAtaExists: !!userInfo, wsolExists: !!wsolInfo,
      preAmount: tokenAmount(userInfo), balance,
      costs: { returned: lockRent + t22Rent, returnedVault: t22Rent, firstTimeRent: userInfo ? 0n : t22Rent, buybackRent: 0n, wsolRent: wsolInfo ? 0n : splRent, accumulatorRent: 0n },
    };
  }

  private async buildReview(m: Market, slippageBps: number, retried: boolean): Promise<Review | 'market' | 'insufficient'> {
    const wallet = this.wallet!;
    const sim = simQuoter(this.rpc, wallet, m.route, m.preAmount, m.wsolExists);
    let r;
    try { r = await computeBuffer(sim, slippageBps); } catch (e) {
      if (e instanceof QuoteError && e.failure.kind === 'insufficient-sol') return 'insufficient';
      throw e;
    }
    if (!r.ok) return 'market';
    const b = r.value;
    // Mode + fees from a dry compile (same shape as the real build).
    const cuPrice = Math.min(Math.max(0, Math.ceil(await getPriorityFee(this.rpc, this.feeAccounts(m)))), MAX_PRIORITY_MICROLAMPORTS);
    const probe: PurchaseIntent = {
      wallet, route: m.route, wsolExists: m.wsolExists, amountIn: b.amountIn, minOut: b.minOut, target: b.target,
      lockId: BigInt(MAX_LOCK_ID), unlockAt: BigInt(this.nowS() + PASS_SECONDS), cuPrice, blockhash: '11111111111111111111111111111111',
    };
    const p = plan(probe, this.forceTwo);
    const feeLamports = this.feeFor(p.mode, cuPrice);
    // Exact one-time setup cost, measured: simulate the swap at A and read the wallet's own
    // pre/post balances (same slot), so any account a program creates on the player's first trade
    // is in the total even if it is not modelled above.
    const costs = await this.measureSetup(m, probe);
    const totalLamports = b.amountIn + costs.returned + costs.firstTimeRent + costs.buybackRent + costs.accumulatorRent + feeLamports;
    return {
      buffer: b, totalLamports, feeLamports, costs, mode: p.mode, firstTime: !m.userAtaExists, balance: m.balance,
      marginBps: Number(((b.amountIn - NOMINAL_LAMPORTS) * 10_000n) / NOMINAL_LAMPORTS), quotedAt: this.nowMs(), cuPrice, retried,
    };
  }

  private async measureSetup(m: Market, probe: PurchaseIntent): Promise<Costs> {
    const tx = compile('swap', { ...probe, cuPrice: 0 });
    const userAta = ata(new PublicKey(probe.wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const r = await simulate(this.rpc, bytesToB64(tx.serialize()), [userAta], true);
    let costs = m.costs;
    // The player's pass-token account and the lock's token account are created for the same mint, so they have the
    // same size: take it from the account the simulation just created instead of from the pool's own vault.
    const space = r.accounts?.[0]?.space;
    if (!r.err && typeof space === 'number' && space >= 165 && space <= 400) {
      const rent = await getRent(this.rpc, space);
      costs = { ...costs, returned: costs.returned - (costs.returnedVault ?? 0n) + rent, firstTimeRent: m.userAtaExists ? 0n : rent, returnedVault: rent };
    }
    if (r.err || !r.preBalances || !r.postBalances) return costs;
    const spent = BigInt(r.preBalances[0]!) - BigInt(r.postBalances[0]!) - BigInt(r.fee ?? 5000);
    const modelled = probe.amountIn + costs.firstTimeRent + costs.buybackRent + costs.accumulatorRent;
    if (spent <= modelled) return costs;
    return { ...costs, accumulatorRent: costs.accumulatorRent + (spent - modelled) };
  }

  private feeAccounts(m: Market): string[] {
    return [DAMM_PROGRAM, DAMM_POOL];
  }

  /** Upper bound of network fees for the plan (base fee + priority at the CU limit). */
  private feeFor(mode: 'single' | 'two', cuPrice: number): bigint {
    const pri = (limit: number) => (BigInt(cuPrice) * BigInt(limit) + 999_999n) / 1_000_000n;
    return mode === 'single' ? SIG_FEE + pri(COMPUTE_UNIT_LIMIT) : 2n * SIG_FEE + pri(COMPUTE_UNIT_LIMIT) + pri(COMPUTE_UNIT_LIMIT_LOCK_ONLY);
  }

  private startRefresh(): void {
    this.stopRefresh();
    this.refreshTimer = setInterval(() => { void this.requote(); }, QUOTE_REFRESH_MS);
  }
  private stopRefresh(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }
  private requoting = false;
  private async requote(): Promise<void> {
    if (this.requoting || this.view.step !== 'review' || !this.market) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    this.requoting = true;
    const ep = this.epoch;
    const before = this.view.review;
    try {
      const r = await this.buildReview(this.market, this.slippageBps, before.retried);
      // Frozen once the player tapped (view left 'review') or the wallet changed.
      if (ep !== this.epoch || this.view.step !== 'review' || this.view.review !== before) return;
      if (r === 'market') this.set({ step: 'market' });
      else if (r !== 'insufficient') this.set({ step: 'review', review: r });
    } catch { /* keep the last quote; confirm() re-simulates anyway */ } finally {
      this.requoting = false;
    }
  }

  // ─────────── 4–9. fresh build, simulation, validator, pending, wallet, reconcile ───────────
  async confirm(): Promise<void> {
    if (this.view.step !== 'review' || !this.market) return;
    const review = this.view.review;
    const wallet = this.wallet!;
    const ep = this.epoch;
    this.set({ step: 'preparing' });
    let built: { intent: PurchaseIntent; txs: VersionedTransaction[]; mode: 'single' | 'two'; lastValidBlockHeight: number; lockPda: string };
    try {
      const b = await this.freshBuild(wallet, review);
      if (ep !== this.epoch) return;
      if ('error' in b) {
        if (b.error.kind === 'chain' && b.error.failure.kind === 'slippage') {
          const next = nextSlippage(this.slippageBps);
          if (next === null) { this.set({ step: 'market' }); return; }
          await this.startPurchase(next, true); // new review → new tap
          return;
        }
        this.set({ step: 'error', error: b.error, back: 'review' });
        return;
      }
      built = b;
    } catch {
      if (ep === this.epoch) this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' });
      return;
    }
    // 7. durable pending record, synchronously, BEFORE the wallet sees anything.
    const now = this.nowMs();
    const rec: PendingRecord = {
      requestId: newRequestId(), wallet, mint: PASS_MINT, amount: built.intent.minOut.toString(),
      amountInLamports: built.intent.amountIn.toString(), lockId: Number(built.intent.lockId), lockPda: built.lockPda,
      intendedUnlockAt: Number(built.intent.unlockAt), createdAt: now, updatedAt: now,
      transport: this.session.adapter?.kind ?? 'mwa', mode: built.mode, state: 'awaiting-wallet', signatures: [],
      blockhash: built.intent.blockhash, lastValidBlockHeight: built.lastValidBlockHeight,
    };
    try { this.store.put(rec); } catch { this.set({ step: 'error', error: { kind: 'storage' }, back: 'review' }); return; }
    await this.handOff(rec, built.txs, ep);
  }

  private async freshBuild(wallet: string, review: Review): Promise<
    { intent: PurchaseIntent; txs: VersionedTransaction[]; mode: 'single' | 'two'; lastValidBlockHeight: number; lockPda: string } | { error: FlowError }
  > {
    const m = this.market!;
    const [bh, locks] = await Promise.all([
      getLatestBlockhash(this.rpc),
      readLocks(this.rpc, wallet, this.store.reservedIds(wallet)),
    ]);
    if (!locks.ok) return { error: { kind: 'rpc' } };
    const id = firstFreeLockId(locks.snapshot.usedIds, this.store.reservedIds(wallet));
    if (id === null) return { error: { kind: 'ids-full' } };
    const nowS = Math.max(this.nowS(), ...locks.snapshot.locks.map((l) => Number(l.createdAt)));
    const intent: PurchaseIntent = {
      wallet, route: m.route, wsolExists: m.wsolExists,
      amountIn: review.buffer.amountIn, minOut: review.buffer.minOut, target: review.buffer.target,
      lockId: BigInt(id), unlockAt: BigInt(nowS + PASS_SECONDS), // recomputed at signing time
      cuPrice: review.cuPrice, blockhash: bh.blockhash,
    };
    const p = plan(intent, this.forceTwo);
    if (p.mode !== review.mode) return { error: { kind: 'validation', reason: 'plan changed' } };
    const kinds: TxKind[] = p.mode === 'single' ? ['single'] : ['swap', 'lock'];
    // 6. validator: the exact bytes the wallet will see.
    for (let i = 0; i < p.txs.length; i++) {
      const raw = p.txs[i]!.serialize();
      const v = validateTransaction(raw, kinds[i]!, intent, nowS);
      if (!v.ok) return { error: { kind: 'validation', reason: v.reason } };
      const nv = await nativeValidate(raw, kinds[i]!, intent, nowS);
      if (!nv.ok) return { error: { kind: 'validation', reason: nv.reason } };
    }
    // 5. simulation of the first transaction against the real blockhash (no replacement).
    const [lock] = lockPda(new PublicKey(wallet), new PublicKey(PASS_MINT), intent.lockId);
    const tx0 = p.txs[0]!;
    const progs = tx0.message.compiledInstructions.map((ix) => tx0.message.staticAccountKeys[ix.programIdIndex]!.toBase58());
    const sim = await simulate(this.rpc, bytesToB64(tx0.serialize()), [wallet, lock.toBase58()], false);
    if (sim.err) return { error: { kind: 'chain', failure: classifyChainError(sim.err, sim.logs, progs) } };
    if (p.mode === 'single') {
      const info = sim.accounts?.[1];
      const l = info ? decodeLock(b64ToBytes(info.data[0])) : null;
      if (!l || l.amount !== intent.minOut || l.unlockAt !== intent.unlockAt || l.lockId !== intent.lockId) {
        return { error: { kind: 'validation', reason: 'simulated pass state mismatch' } };
      }
    }
    // Exact total check: what the simulation took from the wallet must not exceed the review.
    const post = BigInt(sim.accounts?.[0]?.lamports ?? 0);
    const pre = sim.preBalances ? BigInt(sim.preBalances[0]!) : m.balance; // same-slot balance when the node reports it
    const taken = pre - post + (p.mode === 'two' ? review.costs.returned + SIG_FEE : 0n);
    if (taken > review.totalLamports) return { error: { kind: 'validation', reason: `total above the reviewed amount (+${taken - review.totalLamports} lamports)` } };
    return { intent, txs: p.txs, mode: p.mode, lastValidBlockHeight: bh.lastValidBlockHeight, lockPda: lock.toBase58() };
  }

  private async handOff(rec: PendingRecord, txs: VersionedTransaction[], ep: number): Promise<void> {
    const out = await this.session.send(txs, () => this.set({ step: 'wallet' }));
    if (ep !== this.epoch) return;
    if (!out.ok) {
      if (!out.afterHandoff) {
        this.store.update(rec.requestId, { state: 'declined' });
        this.set({ step: 'error', error: { kind: 'wallet', failure: out.failure }, back: 'review' });
        return;
      }
      if (out.failure === 'DECLINED') {
        // MWA ERROR_NOT_SIGNED: the wallet proved nothing was signed.
        this.store.update(rec.requestId, { state: 'declined' });
        this.set({ step: 'error', error: { kind: 'wallet', failure: 'DECLINED' }, back: 'offer' });
        return;
      }
      const u = this.store.update(rec.requestId, { state: 'unknown' })!;
      await this.reconcile(u, ep);
      if (ep === this.epoch && this.view.step !== 'unknown' && this.view.step !== 'activate') await this.readPass(ep);
      return;
    }
    // Signatures persisted before any broadcast of our own.
    let cur = this.store.update(rec.requestId, {
      state: 'submitted', signatures: out.signatures, transport: 'signed' in out ? 'mwa-sign' : rec.transport,
    })!;
    if ('signed' in out) {
      const r = await this.broadcastSigned(cur, out.signed);
      if (r) cur = r;
    }
    const done = await this.reconcile(cur, ep);
    if (done && ep === this.epoch && this.view.step !== 'activate') await this.readPass(ep);
  }

  /** Sign-only fallback: we broadcast the wallet-signed bytes ourselves, in order. */
  private async broadcastSigned(rec: PendingRecord, signed: Uint8Array[]): Promise<PendingRecord | null> {
    for (let i = 0; i < signed.length; i++) {
      try {
        await sendRawTransaction(this.rpc, bytesToB64(signed[i]!));
      } catch (e) {
        if (e instanceof RpcError && e.kind === 'rpc' && i === 0) {
          const d = e.data as { err?: unknown; logs?: string[] } | undefined;
          // Preflight rejected the first transaction: it was never broadcast.
          if (d && d.err !== undefined) return this.store.update(rec.requestId, { state: 'failed' });
        }
        return this.store.update(rec.requestId, { state: 'unknown' });
      }
      if (i === 0 && signed.length > 1) {
        const ok = await this.waitSig(rec.signatures[0]!, rec.lastValidBlockHeight);
        if (ok !== 'confirmed') return null;
      }
    }
    return null;
  }

  private async waitSig(sig: string, lastValid: number): Promise<'confirmed' | 'failed' | 'expired' | 'pending'> {
    const until = this.nowMs() + 90_000;
    while (this.nowMs() < until) {
      try {
        const [s] = await getSignatureStatuses(this.rpc, [sig]);
        if (s?.err) return 'failed';
        if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return 'confirmed';
        if (!s && (await getBlockHeight(this.rpc)) > lastValid) return 'expired';
      } catch { /* keep polling */ }
      await sleep(1_500);
    }
    return 'pending';
  }

  /**
   * Reconcile by signature AND by the lock PDA, for up to 10 minutes after the request. Never
   * re-signs. Returns true when the record reached a definitive state.
   */
  async reconcile(rec: PendingRecord, ep = this.epoch): Promise<boolean> {
    const deadline = rec.createdAt + PENDING_RECONCILE_MS;
    this.set({ step: 'confirming', rec });
    for (;;) {
      if (ep !== this.epoch) return false;
      const r = await this.reconcileOnce(rec).catch(() => 'pending' as const);
      if (r !== 'pending') {
        const cur = this.store.all().find((x) => x.requestId === rec.requestId) ?? rec;
        if (r === 'activate') { this.set({ step: 'activate', rec: cur }); return true; }
        if (r === 'failed') {
          const f = await this.failureOf(cur);
          this.set({ step: 'error', error: f ? { kind: 'chain', failure: f } : { kind: 'rpc' }, back: 'offer' });
          return true;
        }
        if (r === 'expired') {
          this.set({ step: 'error', error: { kind: 'chain', failure: { kind: 'blockhash' } }, back: 'offer' });
          return true;
        }
        return true; // confirmed
      }
      if (this.nowMs() > deadline) {
        const u = this.store.update(rec.requestId, { state: 'unknown' }) ?? rec;
        this.set({ step: 'unknown', rec: u });
        return false;
      }
      await sleep(2_000);
    }
  }

  private async failureOf(rec: PendingRecord): Promise<ChainFailure | null> {
    for (const sig of rec.signatures) {
      try {
        const [s] = await getSignatureStatuses(this.rpc, [sig]);
        if (s?.err) return classifyChainError(s.err);
      } catch { return null; }
    }
    return { kind: 'other', detail: 'failed' };
  }

  private lockMatches(snap: LockSnapshot, rec: PendingRecord): boolean {
    return snap.locks.some((l) => l.address === rec.lockPda && l.amount.toString() === rec.amount
      && Math.abs(Number(l.unlockAt) - rec.intendedUnlockAt) <= 1800);
  }

  private async reconcileOnce(rec: PendingRecord): Promise<'confirmed' | 'failed' | 'expired' | 'activate' | 'pending'> {
    // PDA first: the pass exists → done, whatever the signatures say.
    const locks = await readLocks(this.rpc, rec.wallet, [rec.lockId]);
    if (locks.ok && this.lockMatches(locks.snapshot, rec)) {
      this.store.update(rec.requestId, { state: 'confirmed' });
      return 'confirmed';
    }
    const statuses = rec.signatures.length ? await getSignatureStatuses(this.rpc, rec.signatures) : [];
    const ok = (i: number) => { const s = statuses[i]; return !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized'); };
    const failed = (i: number) => !!statuses[i]?.err;
    const height = await getBlockHeight(this.rpc);
    const expired = height > rec.lastValidBlockHeight;
    if (rec.mode === 'single') {
      if (failed(0)) { this.store.update(rec.requestId, { state: 'failed' }); return 'failed'; }
      if (ok(0)) return 'pending'; // landed: wait for the PDA to show up in the read
      if (expired) { this.store.update(rec.requestId, { state: 'expired' }); return 'expired'; }
      return 'pending';
    }
    // Two transactions: swap (0) then pass (1).
    let swapLanded = ok(0);
    if (!rec.signatures.length && expired) swapLanded = await this.findSwap(rec);
    if (failed(0)) { this.store.update(rec.requestId, { state: 'failed' }); return 'failed'; }
    if (swapLanded && (failed(1) || (expired && !ok(1)))) {
      this.store.update(rec.requestId, { state: failed(1) ? 'failed' : 'expired', swapLanded: true });
      return 'activate';
    }
    if (expired && !swapLanded && !ok(1)) { this.store.update(rec.requestId, { state: 'expired' }); return 'expired'; }
    return 'pending';
  }

  /** Two-transaction case without signatures (app killed): look for our swap after the request. */
  private async findSwap(rec: PendingRecord): Promise<boolean> {
    const userAta = ata(new PublicKey(rec.wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const sigs = await this.rpc.call<{ signature: string; err: unknown; blockTime: number | null }[]>('getSignaturesForAddress', [userAta, { limit: 10, commitment: 'confirmed' }]);
    for (const s of sigs) {
      if (s.err || s.blockTime === null || s.blockTime * 1000 < rec.createdAt - 60_000) continue;
      const tx = await getOwnTransaction<{ transaction: [string, 'base64']; meta: { err: unknown } | null }>(this.rpc, s.signature);
      if (!tx || tx.meta?.err) continue;
      try {
        const d = decodeTransaction(b64ToBytes(tx.transaction[0]));
        if (d.keys[0] === rec.wallet && d.blockhash === rec.blockhash) {
          this.store.update(rec.requestId, { signatures: [s.signature] });
          return true;
        }
      } catch { /* not ours */ }
    }
    return false;
  }

  /** Recovery for the two-transaction case: the swap landed, the pass step did not. */
  async activate(): Promise<void> {
    if (this.view.step !== 'activate') return;
    const old = this.view.rec;
    const wallet = this.wallet;
    if (!wallet || wallet !== old.wallet) return;
    const ep = this.epoch;
    this.set({ step: 'preparing' });
    try {
      const userAta = ata(new PublicKey(wallet), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
      const [[info], bh, locks] = await Promise.all([
        getMultipleAccounts(this.rpc, [userAta]), getLatestBlockhash(this.rpc), readLocks(this.rpc, wallet, this.store.reservedIds(wallet)),
      ]);
      if (ep !== this.epoch) return;
      if (!locks.ok) { this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' }); return; }
      const amount = BigInt(old.amount);
      if (tokenAmount(info) < amount) {
        // The pass token is no longer there: nothing to activate.
        this.store.update(old.requestId, { activatedBy: 'gone' });
        await this.readPass(ep);
        return;
      }
      const id = firstFreeLockId(locks.snapshot.usedIds, this.store.reservedIds(wallet));
      if (id === null) { this.set({ step: 'error', error: { kind: 'ids-full' }, back: 'offer' }); return; }
      const nowS = Math.max(this.nowS(), ...locks.snapshot.locks.map((l) => Number(l.createdAt)));
      const intent: PurchaseIntent = {
        wallet, amountIn: BigInt(old.amountInLamports), minOut: amount, target: amount,
        lockId: BigInt(id), unlockAt: BigInt(nowS + PASS_SECONDS), cuPrice: 0, blockhash: bh.blockhash,
      };
      const tx = compile('lock', intent);
      const v = validateTransaction(tx.serialize(), 'lock', intent, nowS);
      if (!v.ok) { this.set({ step: 'error', error: { kind: 'validation', reason: v.reason }, back: 'offer' }); return; }
      const nv = await nativeValidate(tx.serialize(), 'lock', intent, nowS);
      if (!nv.ok) { this.set({ step: 'error', error: { kind: 'validation', reason: nv.reason }, back: 'offer' }); return; }
      const [lock] = lockPda(new PublicKey(wallet), new PublicKey(PASS_MINT), intent.lockId);
      const sim = await simulate(this.rpc, bytesToB64(tx.serialize()), [lock.toBase58()], false);
      if (sim.err) {
        const progs = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58());
        this.set({ step: 'error', error: { kind: 'chain', failure: classifyChainError(sim.err, sim.logs, progs) }, back: 'offer' });
        return;
      }
      const now = this.nowMs();
      const rec: PendingRecord = {
        requestId: newRequestId(), wallet, mint: PASS_MINT, amount: amount.toString(), amountInLamports: old.amountInLamports,
        lockId: id, lockPda: lock.toBase58(), intendedUnlockAt: Number(intent.unlockAt), createdAt: now, updatedAt: now,
        transport: this.session.adapter?.kind ?? 'mwa', mode: 'single', state: 'awaiting-wallet', signatures: [],
        blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight,
      };
      try { this.store.put(rec); this.store.update(old.requestId, { activatedBy: rec.requestId }); } catch {
        this.set({ step: 'error', error: { kind: 'storage' }, back: 'offer' }); return;
      }
      await this.handOff(rec, [tx], ep);
    } catch {
      if (ep === this.epoch) this.set({ step: 'error', error: { kind: 'rpc' }, back: 'offer' });
    }
  }

  /** "Check again" from the unknown state: one more reconciliation window, never a new signature. */
  async checkAgain(): Promise<void> {
    if (this.view.step !== 'unknown') return;
    const rec = this.view.rec;
    const ep = this.epoch;
    const r = await this.reconcileOnce(rec).catch(() => 'pending' as const);
    if (ep !== this.epoch) return;
    if (r === 'pending') {
      // Past the blockhash lifetime with no trace of either signature: the request can no longer land.
      this.set({ step: 'unknown', rec });
      return;
    }
    await this.refresh();
  }

  private releasing = false;
  /**
   * Release an ended pass: the locked token goes back to the wallet (2% fee) and the
   * rent of both accounts is returned. A repeat after an unknown result is harmless: the second
   * attempt fails on chain because the pass account is already closed.
   */
  async release(lock: VerifiedLock, onHandoff: () => void = () => {}, fetchJson?: FetchJson): Promise<ReleaseOutcome> {
    const wallet = this.wallet;
    if (!wallet || this.releasing) return { ok: false, reason: 'busy' };
    this.releasing = true;
    const ep = this.epoch;
    try {
      const b = await buildClaim(this.rpc, wallet, lock, this.nowS(), fetchJson);
      if (!b.ok) {
        if (b.reason === 'no-route') return { ok: false, reason: 'waiting' };
        if (b.reason === 'not-ended') return { ok: false, reason: 'not-ended' };
        if (b.reason === 'chain') return { ok: false, reason: 'error', error: { kind: 'chain', failure: b.failure } };
        if (b.reason === 'validation' || b.reason === 'too-large') return { ok: false, reason: 'error', error: { kind: 'validation', reason: b.detail ?? b.reason } };
        return { ok: false, reason: 'error', error: { kind: 'rpc' } };
      }
      const out = await this.session.send([b.tx], onHandoff);
      if (!out.ok) {
        if (!out.afterHandoff || out.failure === 'DECLINED') return { ok: false, reason: 'error', error: { kind: 'wallet', failure: out.failure } };
      } else if ('signed' in out) {
        try { await sendRawTransaction(this.rpc, bytesToB64(out.signed[0]!)); } catch { /* reconcile below decides */ }
      }
      // Done when the pass account is gone.
      const until = this.nowMs() + 120_000;
      while (this.nowMs() < until && ep === this.epoch) {
        try {
          const [info] = await getMultipleAccounts(this.rpc, [lock.address]);
          if (!info) { void this.refresh(); return { ok: true, returnedLamports: b.returnedLamports }; }
          if (out.ok) {
            const [s] = await getSignatureStatuses(this.rpc, out.signatures);
            if (s?.err) return { ok: false, reason: 'error', error: { kind: 'chain', failure: classifyChainError(s.err) } };
          }
          if ((await getBlockHeight(this.rpc)) > b.lastValidBlockHeight + 10) break;
        } catch { /* keep polling */ }
        await sleep(2_000);
      }
      return { ok: false, reason: 'unknown' };
    } catch {
      return { ok: false, reason: 'error', error: { kind: 'rpc' } };
    } finally {
      this.releasing = false;
    }
  }

  back(to: 'offer' | 'review' | 'disconnected'): void {
    if (to === 'disconnected' || !this.wallet) { this.set({ step: 'disconnected' }); return; }
    if (to === 'review') { void this.startPurchase(this.slippageBps); return; }
    void this.refresh();
  }
}

