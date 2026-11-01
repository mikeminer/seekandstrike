import { HttpRpc, RpcError, type Rpc } from '../rpc';

/** Public mainnet RPC with pacing + retry on rate limiting (sim runs only). */
export class PacedRpc implements Rpc {
  private inner = new HttpRpc({ endpoints: [process.env.SIM_RPC ?? 'https://api.mainnet-beta.solana.com'], timeoutMs: 20_000 });
  private last = 0;
  calls = 0;
  readonly log: string[] = [];
  get label(): string { return 'mainnet-paced'; }
  async call<T>(method: string, params: unknown[]): Promise<T> {
    if (method === 'sendTransaction') throw new Error('simulations never send');
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + 260 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      this.calls++;
      this.log.push(method);
      try { return await this.inner.call<T>(method, params); } catch (e) {
        if (e instanceof RpcError && e.kind === 'unavailable' && attempt < 6) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        throw e;
      }
    }
  }
}

export const memoryKv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
