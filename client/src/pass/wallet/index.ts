import type { VersionedTransaction } from '@solana/web3.js';
import type { ConnectOutcome, SendOutcome, SignOutcome, WalletAdapter } from './types';

export * from './types';

export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Single-flight wallet coordinator: one request at a time, only while the game is visible,
 * and the adapter is bound to the connected account ("wallet generation").
 */
export class WalletSession {
  private busy = false;
  adapter: WalletAdapter | null = null;
  address: string | null = null;
  generation = 0;
  private listeners = new Set<() => void>();

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private emit(): void { this.listeners.forEach((l) => l()); }
  get isBusy(): boolean { return this.busy; }

  private guard(): ConnectOutcome | null {
    if (this.busy) return { ok: false, failure: 'BUSY' };
    if (document.visibilityState !== 'visible') return { ok: false, failure: 'NOT_FOREGROUND' };
    return null;
  }

  async connect(adapter: WalletAdapter): Promise<ConnectOutcome> {
    const g = this.guard();
    if (g) return g;
    this.busy = true;
    try {
      const r = await adapter.connect();
      if (r.ok) {
        if (r.address !== this.address) this.generation++;
        this.adapter = adapter;
        this.address = r.address;
        this.emit();
      }
      return r;
    } finally {
      this.busy = false;
    }
  }

  async send(txs: VersionedTransaction[], onHandoff: () => void): Promise<SendOutcome> {
    const g = this.guard();
    if (g && !g.ok) return { ok: false, failure: g.failure, afterHandoff: false };
    if (!this.adapter || !this.address) return { ok: false, failure: 'AUTH_FAILED', afterHandoff: false };
    this.busy = true;
    try {
      return await this.adapter.signAndSend(this.address, txs, onHandoff);
    } finally {
      this.busy = false;
    }
  }

  /** Asks the connected wallet to sign a plain-text message (single-flight and foreground-only, like every wallet request). */
  async signMessage(message: Uint8Array): Promise<SignOutcome> {
    const g = this.guard();
    if (g && !g.ok) return { ok: false, failure: g.failure };
    if (!this.adapter?.signMessage || !this.address) return { ok: false, failure: this.adapter ? 'UNSUPPORTED' : 'AUTH_FAILED' };
    this.busy = true;
    try {
      return await this.adapter.signMessage(this.address, message);
    } finally {
      this.busy = false;
    }
  }

  async disconnect(): Promise<void> {
    await this.adapter?.disconnect();
    this.adapter = null;
    this.address = null;
    this.generation++;
    this.emit();
  }
}
