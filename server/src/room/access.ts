/**
 * Online access control: who may take a seat.
 *
 * 1. `AccessGate.begin` issues a challenge text for a wallet (single use, 60 s, bound to the room).
 * 2. The wallet signs it; `AccessGate.finish` checks the Ed25519 signature against the wallet's public key.
 * 3. Only then does the server read the chain (`PassVerifier`) and, for an active Daily Pass, grant the seat until
 *    the pass expires. A stolen signature is useless: the challenge only exists on the socket that received it.
 *
 * The chain read is the same code the client uses for its own pass check (client/src/pass: reader, receipt rule and the
 * vendored Season Pass evaluator), so client and server can never disagree about what a valid pass is. The server only
 * reads: it never signs or sends anything.
 */
import '@pass/polyfill';
import { PublicKey } from '@solana/web3.js';
import { SIG_B64_RE, WALLET_RE, PROOF_TTL_MS, challengeMessage, type Challenge } from '@shared/passProof';
import type { ErrorCode } from '@shared/protocol';
import { readLocks } from '@pass/reader';
import { verifyReceipt } from '@pass/receipt';
import { HttpRpc, type Rpc } from '@pass/rpc';
import { evaluatePass } from '@pass/validity';

export type PassCheck = { ok: true; expiresAt: number } | { ok: false; reason: 'no_pass' | 'unavailable' };
export interface PassVerifier { check(wallet: string): Promise<PassCheck> }

export interface VerifierOptions {
  now?: () => number;
  /** How long a positive answer is reused (quick re-joins cost no RPC). */
  positiveTtlMs?: number;
  /** How long "no pass" is remembered, so a fresh keypair cannot make us read the chain over and over. */
  negativeTtlMs?: number;
  /** Chain reads allowed at once; more are answered "unavailable" instead of queueing. */
  maxConcurrent?: number;
}

const CACHE_MAX = 512;

/** Reads the wallet's Fridge locks and applies the Daily Pass rules (floor rule, then the receipt rule). */
export class RpcPassVerifier implements PassVerifier {
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; res: PassCheck }>();
  private readonly inflight = new Map<string, Promise<PassCheck>>();
  private running = 0;

  constructor(private readonly rpc: Rpc, private readonly o: VerifierOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  async check(wallet: string): Promise<PassCheck> {
    const hit = this.cache.get(wallet);
    if (hit) {
      const ttl = hit.res.ok ? (this.o.positiveTtlMs ?? 60_000) : (this.o.negativeTtlMs ?? 10_000);
      const stillValid = hit.res.ok ? hit.res.expiresAt * 1000 > this.now() : true;
      if (this.now() - hit.at < ttl && stillValid) return hit.res;
      this.cache.delete(wallet);
    }
    const running = this.inflight.get(wallet);
    if (running) return running;
    if (this.running >= (this.o.maxConcurrent ?? 4)) return { ok: false, reason: 'unavailable' };
    this.running++;
    const p = this.read(wallet).then((res) => {
      // "unavailable" is never cached: the next attempt may well work.
      if (!(!res.ok && res.reason === 'unavailable')) {
        if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(wallet, { at: this.now(), res });
      }
      return res;
    }).finally(() => { this.running--; this.inflight.delete(wallet); });
    this.inflight.set(wallet, p);
    return p;
  }

  private async read(wallet: string): Promise<PassCheck> {
    try {
      const read = await readLocks(this.rpc, wallet);
      if (!read.ok) return { ok: false, reason: 'unavailable' };
      const receiptOk = new Set<string>();
      let st = evaluatePass(read.snapshot, wallet, Math.floor(this.now() / 1000), receiptOk);
      if (st.state === 'none' && st.pendingReceipt.length) {
        for (const l of st.pendingReceipt.slice(0, 3)) if (await verifyReceipt(this.rpc, l, wallet)) receiptOk.add(l.address);
        st = evaluatePass(read.snapshot, wallet, Math.floor(this.now() / 1000), receiptOk);
      }
      return st.state === 'active' ? { ok: true, expiresAt: st.expiresAt } : { ok: false, reason: 'no_pass' };
    } catch {
      // Stale or malformed evidence: fail closed, but report it as an outage, not as "you have no pass".
      return { ok: false, reason: 'unavailable' };
    }
  }
}

/** The read-only RPC the server uses. https only, except a loopback address (a fake node for local tests). */
export function passRpcFromUrl(url: string | undefined): Rpc | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const loopback = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  if (u.protocol !== 'https:' && !loopback) return null;
  // workerd does not implement every RequestInit field the browser client sets (credentials, cache).
  const fetchImpl: typeof fetch = (input, init) => fetch(input, { method: init?.method, headers: init?.headers, body: init?.body, signal: init?.signal });
  return new HttpRpc({ endpoints: [url], fetchImpl });
}

const b64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Ed25519 check of a wallet's signature over `text` (the wallet address IS the public key). */
export async function verifyWalletSignature(wallet: string, text: string, sigB64: string): Promise<boolean> {
  if (!WALLET_RE.test(wallet) || !SIG_B64_RE.test(sigB64)) return false;
  try {
    const pub = new Uint8Array(new PublicKey(wallet).toBytes());
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(sigB64), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/** What a socket remembers between `challenge` and `auth` (small enough for a WebSocket attachment). */
export interface PendingAuth extends Challenge { name?: string; cls?: number }

export type Verdict = { ok: true; wallet: string; expiresAt: number } | { ok: false; error: ErrorCode };

export interface GateOptions {
  roomId: string;
  verifier: PassVerifier;
  now?: () => number;
  random?: (n: number) => Uint8Array;
}

export class AccessGate {
  private readonly now: () => number;
  private readonly random: (n: number) => Uint8Array;
  constructor(private readonly o: GateOptions) {
    this.now = o.now ?? Date.now;
    this.random = o.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  }

  /** Starts a proof for `wallet`; null when the address is not a plausible Solana address. */
  begin(wallet: string | undefined, extra: { name?: string; cls?: number } = {}): { pending: PendingAuth; message: string; expiresInMs: number } | null {
    if (!wallet || !WALLET_RE.test(wallet)) return null;
    try { new PublicKey(wallet); } catch { return null; }
    const iat = this.now();
    const c: Challenge = { wallet, room: this.o.roomId, nonce: hex(this.random(16)), iat, exp: iat + PROOF_TTL_MS };
    return { pending: { ...c, ...extra }, message: challengeMessage(c), expiresInMs: PROOF_TTL_MS };
  }

  /** Checks the signature, then the pass. The caller must have cleared `pending` first (a challenge is single use). */
  async finish(pending: PendingAuth, sigB64: string): Promise<Verdict> {
    if (this.now() > pending.exp) return { ok: false, error: 'proof_expired' };
    const text = challengeMessage({ wallet: pending.wallet, room: pending.room, nonce: pending.nonce, iat: pending.iat, exp: pending.exp });
    if (!(await verifyWalletSignature(pending.wallet, text, sigB64))) return { ok: false, error: 'proof_invalid' };
    const pass = await this.o.verifier.check(pending.wallet);
    if (!pass.ok) return { ok: false, error: pass.reason === 'no_pass' ? 'pass_required' : 'pass_unavailable' };
    return { ok: true, wallet: pending.wallet, expiresAt: pass.expiresAt };
  }
}

/** Which seat belongs to which verified wallet, until when. One wallet holds one seat; a new proof takes it over. */
export class PassRegistry {
  private readonly bySeat = new Map<number, { wallet: string; token: string; expiresAt: number }>();
  private readonly byWallet = new Map<string, number>();

  grant(seat: number, token: string, wallet: string, expiresAt: number): void {
    this.drop(seat);
    this.bySeat.set(seat, { wallet, token, expiresAt });
    this.byWallet.set(wallet, seat);
  }
  /** The seat (and its resume token) a wallet was granted, if any. May be stale: the caller checks the token against the room. */
  holder(wallet: string): { seat: number; token: string } | null {
    const seat = this.byWallet.get(wallet);
    const g = seat === undefined ? undefined : this.bySeat.get(seat);
    return seat !== undefined && g ? { seat, token: g.token } : null;
  }
  /** True when `token` belongs to a seat whose pass is still valid: reconnecting needs no new signature. */
  resumable(token: string, nowMs: number): boolean {
    for (const g of this.bySeat.values()) if (g.token === token && g.expiresAt * 1000 > nowMs) return true;
    return false;
  }
  /** Seats whose pass ran out (with the token, so a seat id reused by someone else is never touched). */
  expired(nowMs: number): { seat: number; token: string }[] {
    const out: { seat: number; token: string }[] = [];
    for (const [seat, g] of this.bySeat) if (g.expiresAt * 1000 <= nowMs) out.push({ seat, token: g.token });
    return out;
  }
  drop(seat: number): void {
    const g = this.bySeat.get(seat);
    if (!g) return;
    this.bySeat.delete(seat);
    if (this.byWallet.get(g.wallet) === seat) this.byWallet.delete(g.wallet);
  }
  /** Verified wallet of a seat (null for seats admitted without a pass, e.g. local tests). */
  walletOf(seat: number): string | null { return this.bySeat.get(seat)?.wallet ?? null; }
  clear(): void { this.bySeat.clear(); this.byWallet.clear(); }
  get size(): number { return this.bySeat.size; }
}
