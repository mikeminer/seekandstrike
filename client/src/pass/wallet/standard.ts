import '../polyfill';
import type { VersionedTransaction } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type {
  SolanaSignAndSendTransactionFeature, SolanaSignAndSendAllTransactionsFeature, SolanaSignMessageFeature,
} from '@solana/wallet-standard-features';
import { sigToB58 } from '../sig';
import type { ConnectOutcome, SendOutcome, SignOutcome, WalletAdapter, WalletFailure } from './types';

const CHAIN = 'solana:mainnet' as const;
type Connect = { 'standard:connect': { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> } };
type Disconnect = { 'standard:disconnect'?: { disconnect(): Promise<void> } };

export function compatibleWallets(): Wallet[] {
  return getWallets().get().filter((w) => {
    const f = w.features as Record<string, { supportedTransactionVersions?: readonly unknown[] }>;
    const s = f['solana:signAndSendTransaction'];
    return w.chains.includes(CHAIN) && !!f['standard:connect'] && !!s && (s.supportedTransactionVersions ?? []).includes(0);
  });
}

/** EIP-1193-style 4001 = user rejected the request (Phantom, Solflare, Backpack). */
function classify(e: unknown, afterHandoff: boolean): WalletFailure {
  const code = (e as { code?: unknown })?.code;
  if (code === 4001) return 'DECLINED';
  if (code === 4100) return 'AUTH_FAILED';
  return afterHandoff ? 'OUTCOME_UNKNOWN' : 'WALLET_CANCELLED';
}

export class StandardAdapter implements WalletAdapter {
  readonly kind = 'standard' as const;
  private account: WalletAccount | null = null;
  constructor(private readonly wallet: Wallet) {}
  get label(): string { return this.wallet.name; }

  async connect(): Promise<ConnectOutcome> {
    try {
      const r = await (this.wallet.features as unknown as Connect)['standard:connect'].connect();
      const acc = r.accounts.find((a) => a.chains.includes(CHAIN)) ?? r.accounts[0];
      if (!acc) return { ok: false, failure: 'AUTH_FAILED' };
      this.account = acc;
      return { ok: true, address: acc.address };
    } catch (e) {
      const f = classify(e, false);
      return { ok: false, failure: f === 'DECLINED' ? 'AUTH_FAILED' : f };
    }
  }

  async signAndSend(address: string, txs: VersionedTransaction[], onHandoff: () => void): Promise<SendOutcome> {
    const acc = this.account;
    if (!acc || acc.address !== address) return { ok: false, failure: 'WRONG_ACCOUNT', afterHandoff: false };
    const feats = this.wallet.features as unknown as Partial<SolanaSignAndSendTransactionFeature & SolanaSignAndSendAllTransactionsFeature>;
    const inputs = txs.map((t) => ({ account: acc, chain: CHAIN, transaction: t.serialize(), options: { commitment: 'confirmed' as const } }));
    let handed = false;
    try {
      onHandoff();
      handed = true;
      const all = feats['solana:signAndSendAllTransactions'];
      if (txs.length > 1 && all) {
        const res = await all.signAndSendAllTransactions(inputs, { mode: 'serial' });
        const sigs: string[] = [];
        for (const r of res) {
          if (r.status === 'fulfilled') sigs.push(sigToB58(r.value.signature));
          else if (sigs.length === 0) throw r.reason;
          else return { ok: true, signatures: sigs }; // swap landed, pass step did not → Activate
        }
        return { ok: true, signatures: sigs };
      }
      const one = feats['solana:signAndSendTransaction'];
      if (!one) return { ok: false, failure: 'UNSUPPORTED', afterHandoff: false };
      const sigs: string[] = [];
      for (const input of inputs) {
        try {
          const [out] = await one.signAndSendTransaction(input);
          if (!out) throw new Error('no output');
          sigs.push(sigToB58(out.signature));
        } catch (e) {
          if (sigs.length === 0) throw e;
          return { ok: true, signatures: sigs };
        }
      }
      return { ok: true, signatures: sigs };
    } catch (e) {
      return { ok: false, failure: classify(e, handed), afterHandoff: handed };
    }
  }

  async signMessage(address: string, message: Uint8Array): Promise<SignOutcome> {
    const acc = this.account;
    if (!acc || acc.address !== address) return { ok: false, failure: 'WRONG_ACCOUNT' };
    const feat = (this.wallet.features as unknown as Partial<SolanaSignMessageFeature>)['solana:signMessage'];
    if (!feat) return { ok: false, failure: 'UNSUPPORTED' };
    try {
      const [out] = await feat.signMessage({ account: acc, message });
      // The proof is only valid over exactly our text: a wallet that prefixes or rewrites it cannot be used.
      if (!out || out.signature.length !== 64 || out.signedMessage.length !== message.length || !message.every((b, i) => out.signedMessage[i] === b)) {
        return { ok: false, failure: 'UNSUPPORTED' };
      }
      return { ok: true, signature: out.signature };
    } catch (e) {
      const f = classify(e, false);
      return { ok: false, failure: f };
    }
  }

  async disconnect(): Promise<void> {
    this.account = null;
    try { await (this.wallet.features as unknown as Disconnect)['standard:disconnect']?.disconnect(); } catch { /* ignore */ }
  }
}
