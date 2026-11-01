import type { VersionedTransaction } from '@solana/web3.js';
import { sigToB58 } from '../sig';
import type { ConnectOutcome, SendOutcome, WalletAdapter, WalletFailure } from './types';

/**
 * DEV-only mock wallet (compiled out of release: only imported behind __DEV_PASS_BYPASS__).
 * It NEVER signs: it records the unsigned transactions it was handed and returns a scripted outcome.
 */
export type MockScript = 'ok' | 'activate' | WalletFailure;

export class MockAdapter implements WalletAdapter {
  readonly kind = 'mock' as const;
  readonly label = 'Mock wallet (DEV)';
  readonly handed: Uint8Array[][] = [];
  /** Optional DEV chain overlay: receives each "sent" transaction (simulated, never broadcast). */
  onSent: ((tx: VersionedTransaction, sig: string) => Promise<void>) | null = null;
  constructor(readonly address: string, public script: MockScript = 'ok', private readonly delayMs = 400) {}
  async connect(): Promise<ConnectOutcome> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.script === 'AUTH_FAILED' || this.script === 'NO_WALLET' || this.script === 'LOOPBACK_DENIED') return { ok: false, failure: this.script };
    return { ok: true, address: this.address };
  }
  async signAndSend(address: string, txs: VersionedTransaction[], onHandoff: () => void): Promise<SendOutcome> {
    if (address !== this.address) return { ok: false, failure: 'WRONG_ACCOUNT', afterHandoff: false };
    onHandoff();
    this.handed.push(txs.map((t) => t.serialize()));
    await new Promise((r) => setTimeout(r, this.delayMs));
    const sigs = txs.map(() => sigToB58(crypto.getRandomValues(new Uint8Array(64))));
    if (this.script === 'ok') {
      for (let i = 0; i < txs.length; i++) await this.onSent?.(txs[i]!, sigs[i]!);
      return { ok: true, signatures: sigs };
    }
    if (this.script === 'activate') {
      // Only the first of two transactions "lands" (the recovery case).
      await this.onSent?.(txs[0]!, sigs[0]!);
      return { ok: true, signatures: [sigs[0]!] };
    }
    return { ok: false, failure: this.script, afterHandoff: this.script !== 'DECLINED' && this.script !== 'WALLET_CANCELLED' };
  }
  async disconnect(): Promise<void> {}
}
