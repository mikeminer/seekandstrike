import { RPC_TIMEOUT_MS } from './constants';

/** Minimal JSON-RPC client with ordered endpoint failover and a hard per-attempt deadline. */
export interface Rpc {
  call<T = unknown>(method: string, params: unknown[]): Promise<T>;
  readonly label: string;
}

export class RpcError extends Error {
  constructor(readonly kind: 'unavailable' | 'rpc', message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
  }
}

export interface HttpRpcOptions { endpoints: string[]; timeoutMs?: number; fetchImpl?: typeof fetch }

export class HttpRpc implements Rpc {
  private next = 0;
  private id = 1;
  constructor(private readonly opts: HttpRpcOptions) {
    if (!opts.endpoints.length) throw new Error('no RPC endpoints');
  }
  get label(): string { return this.opts.endpoints[this.next] ?? ''; }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const eps = this.opts.endpoints;
    let lastErr: unknown;
    for (let attempt = 0; attempt < eps.length; attempt++) {
      const idx = (this.next + attempt) % eps.length;
      const url = eps[idx]!;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? RPC_TIMEOUT_MS);
      try {
        const f = this.opts.fetchImpl ?? fetch;
        // `credentials` / `cache` are browser fields (the Workers RequestInit type does not list them; the server passes its own fetch).
        const init: RequestInit & { credentials?: 'omit'; cache?: 'no-store' } = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params }),
          signal: ctl.signal,
          credentials: 'omit',
          cache: 'no-store',
        };
        const res = await f(url, init);
        if (res.status === 429 || res.status >= 500 || res.status === 403) {
          lastErr = new RpcError('unavailable', `http ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
        if (body.error) {
          // Method-level errors (bad params, preflight failure) are answers, not outages, EXCEPT
          // rate limiting / proxy policy denials which mean "try the next endpoint".
          if (body.error.code === -32005 || body.error.code === -32429 || body.error.code === -32601) {
            lastErr = new RpcError('unavailable', body.error.message, body.error.code);
            continue;
          }
          this.next = idx;
          throw new RpcError('rpc', body.error.message, body.error.code, body.error.data);
        }
        this.next = idx;
        return body.result as T;
      } catch (e) {
        if (e instanceof RpcError && e.kind === 'rpc') throw e;
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof RpcError ? lastErr : new RpcError('unavailable', 'all endpoints failed');
  }
}

// ---------- typed helpers ----------
export interface AccountInfoB64 { owner: string; lamports: number; data: [string, 'base64']; executable: boolean; space?: number }
interface Ctx<T> { context: { slot: number }; value: T }

export async function getMultipleAccounts(rpc: Rpc, keys: string[]): Promise<(AccountInfoB64 | null)[]> {
  const out: (AccountInfoB64 | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const r = await rpc.call<Ctx<(AccountInfoB64 | null)[]>>('getMultipleAccounts', [
      keys.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' },
    ]);
    out.push(...r.value);
  }
  return out;
}
export async function getBalance(rpc: Rpc, key: string): Promise<bigint> {
  const r = await rpc.call<Ctx<number>>('getBalance', [key, { commitment: 'confirmed' }]);
  return BigInt(r.value);
}
export async function getLatestBlockhash(rpc: Rpc): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const r = await rpc.call<Ctx<{ blockhash: string; lastValidBlockHeight: number }>>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.value;
}
export async function getBlockHeight(rpc: Rpc): Promise<number> {
  return rpc.call<number>('getBlockHeight', [{ commitment: 'confirmed' }]);
}
export async function getRent(rpc: Rpc, size: number): Promise<bigint> {
  return BigInt(await rpc.call<number>('getMinimumBalanceForRentExemption', [size, { commitment: 'confirmed' }]));
}
export async function getGenesisHash(rpc: Rpc): Promise<string> {
  return rpc.call<string>('getGenesisHash', []);
}
export async function getPriorityFee(rpc: Rpc, accounts: string[]): Promise<number> {
  try {
    const r = await rpc.call<{ slot: number; prioritizationFee: number }[]>('getRecentPrioritizationFees', [accounts.slice(0, 128)]);
    const fees = r.map((x) => x.prioritizationFee).sort((a, b) => a - b);
    if (!fees.length) return 0;
    return fees[Math.floor(fees.length / 2)] ?? 0; // median
  } catch {
    return 0;
  }
}
export interface SimResult {
  err: unknown; logs: string[] | null; unitsConsumed?: number;
  accounts?: (AccountInfoB64 | null)[] | null;
  /** Agave ≥ 2.x: same-slot balances of every account key, and the fee the bank would charge. */
  preBalances?: number[]; postBalances?: number[]; fee?: number;
}
export async function simulate(rpc: Rpc, txB64: string, accounts: string[] = [], replaceRecentBlockhash = true): Promise<SimResult> {
  const r = await rpc.call<Ctx<SimResult>>('simulateTransaction', [txB64, {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash, commitment: 'confirmed',
    ...(accounts.length ? { accounts: { encoding: 'base64', addresses: accounts } } : {}),
  }]);
  return r.value;
}
export interface SigStatus { slot: number; confirmations: number | null; err: unknown; confirmationStatus?: 'processed' | 'confirmed' | 'finalized' }
export async function getSignatureStatuses(rpc: Rpc, sigs: string[]): Promise<(SigStatus | null)[]> {
  const r = await rpc.call<Ctx<(SigStatus | null)[]>>('getSignatureStatuses', [sigs, { searchTransactionHistory: true }]);
  return r.value;
}
export async function sendRawTransaction(rpc: Rpc, txB64: string): Promise<string> {
  return rpc.call<string>('sendTransaction', [txB64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 }]);
}

/**
 * getTransaction for our own (v0/legacy) transactions. Mainnet now also carries newer transaction
 * versions; those can never be ours, so "version not supported" (-32015) reads as "not ours" (null)
 * instead of failing the whole check.
 */
export async function getOwnTransaction<T>(rpc: Rpc, sig: string): Promise<T | null> {
  try {
    return await rpc.call<T | null>('getTransaction', [sig, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  } catch (e) {
    if (e instanceof RpcError && e.code === -32015) return null;
    throw e;
  }
}
