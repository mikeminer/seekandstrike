/**
 * Durable pending-purchase records (brief §9.5-quater). Written SYNCHRONOUSLY to localStorage before
 * the wallet handoff, so an app kill during the wallet round-trip never loses track of a request.
 *
 *   awaiting-wallet ─▶ submitted(sig) ─▶ confirmed
 *          │                 └────────▶ failed (on-chain error) / expired (blockhash, never landed)
 *          ├─▶ declined (wallet said no, nothing sent)
 *          └─▶ unknown (timeout / app killed: reconcile, NEVER re-sign automatically)
 */
export type PendingState = 'awaiting-wallet' | 'submitted' | 'unknown' | 'confirmed' | 'declined' | 'failed' | 'expired';

export interface PendingRecord {
  requestId: string;
  wallet: string;
  mint: string;
  /** Raw pass-token amount the pass locks (the reviewed guaranteed minimum). */
  amount: string;
  amountInLamports: string;
  lockId: number;
  lockPda: string;
  intendedUnlockAt: number;
  createdAt: number; // ms
  updatedAt: number; // ms
  transport: 'mwa' | 'mwa-sign' | 'standard' | 'mock';
  mode: 'single' | 'two';
  state: PendingState;
  /** Signatures in transaction order (swap first in two-transaction mode). */
  signatures: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** For two-transaction mode: swap landed but the pass step did not (offer "Activate"). */
  swapLanded?: boolean;
  /** Activate recovery: the request id that locked this swap's pass token (or "gone"). */
  activatedBy?: string;
}

const KEY = 'sas.pass.pending.v1';
const MAX_RECORDS = 20;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export class PendingStore {
  constructor(private readonly kv: KV = localStorage) {}

  all(): PendingRecord[] {
    try {
      const raw = this.kv.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as PendingRecord[]) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  forWallet(wallet: string): PendingRecord[] {
    return this.all().filter((r) => r.wallet === wallet);
  }
  /** Synchronous write; throws if storage is unavailable (the purchase must then not proceed). */
  put(rec: PendingRecord): void {
    const list = this.all().filter((r) => r.requestId !== rec.requestId);
    list.push(rec);
    list.sort((a, b) => b.createdAt - a.createdAt);
    this.kv.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
    const check = this.all().find((r) => r.requestId === rec.requestId);
    if (!check || check.state !== rec.state) throw new Error('pending record not persisted');
  }
  update(requestId: string, patch: Partial<PendingRecord>): PendingRecord | null {
    const cur = this.all().find((r) => r.requestId === requestId);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    this.put(next);
    return next;
  }
  /** Open records still needing reconciliation for this wallet. */
  open(wallet: string): PendingRecord[] {
    return this.forWallet(wallet).filter((r) => r.state === 'awaiting-wallet' || r.state === 'submitted' || r.state === 'unknown');
  }
  /** Lock ids reserved by records that may still land. */
  reservedIds(wallet: string): number[] {
    const hour = 60 * 60_000;
    return this.forWallet(wallet)
      .filter((r) => r.state === 'awaiting-wallet' || r.state === 'submitted' || r.state === 'unknown'
        || (r.state === 'confirmed' && Date.now() - r.updatedAt < hour))
      .map((r) => r.lockId);
  }
}

export function newRequestId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
