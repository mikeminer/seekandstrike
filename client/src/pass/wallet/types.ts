import type { VersionedTransaction } from '@solana/web3.js';

/** Normalized transport outcomes (skill seeker-wallet.md "Map native/adapter outcomes"). */
export type WalletFailure =
  | 'AUTH_FAILED'        // authorization refused / revoked
  | 'DECLINED'           // the wallet proved it did not sign/broadcast
  | 'WALLET_CANCELLED'   // the sheet/app closed BEFORE any transaction was handed over
  | 'BUSY'               // another wallet request is still open
  | 'NOT_FOREGROUND'     // the game is not visible: never launch a wallet in background
  | 'OUTCOME_UNKNOWN'    // after handoff: timeout / session closed / ambiguous → reconcile
  | 'NO_WALLET'          // no compatible wallet app / extension
  | 'LOOPBACK_DENIED'    // Chrome local network permission denied
  | 'WRONG_ACCOUNT'      // wallet returned a different account than the connected one
  | 'UNSUPPORTED';       // neither sign-and-send nor sign-only is available

export type SendOutcome =
  | { ok: true; signatures: string[] }
  /** Sign-only fallback (MWA −32601): signed bytes to broadcast through our RPC. */
  | { ok: true; signed: Uint8Array[]; signatures: string[] }
  | { ok: false; failure: WalletFailure; afterHandoff: boolean };

export type ConnectOutcome = { ok: true; address: string } | { ok: false; failure: WalletFailure };

/** A wallet's Ed25519 signature (64 bytes) over a plain-text message. Used for the online access proof; no transaction is involved. */
export type SignOutcome = { ok: true; signature: Uint8Array } | { ok: false; failure: WalletFailure };

export interface WalletAdapter {
  readonly kind: 'mwa' | 'standard' | 'mock';
  readonly label: string;
  connect(): Promise<ConnectOutcome>;
  /** Signs exactly `message` (never modified) with the account `address`. Optional: not every wallet can. */
  signMessage?(address: string, message: Uint8Array): Promise<SignOutcome>;
  /**
   * Hand the exact unsigned transactions to the wallet. `onHandoff` is called synchronously right
   * before the transactions leave the app (so the pending record can move to "awaiting-wallet").
   */
  signAndSend(address: string, txs: VersionedTransaction[], onHandoff: () => void): Promise<SendOutcome>;
  disconnect(): Promise<void>;
}

/** Auth tokens never go to WebView storage (skill rule): memory, or the native host's secure store. */
export interface SecureStore { get(key: string): Promise<string | null>; set(key: string, v: string | null): Promise<void> }
interface HostBridge { secureStore?: SecureStore }
const mem = new Map<string, string>();
export const secureStore: SecureStore = {
  async get(k) {
    const host = (globalThis as unknown as { SasHost?: HostBridge }).SasHost;
    if (host?.secureStore) return host.secureStore.get(k);
    return mem.get(k) ?? null;
  },
  async set(k, v) {
    const host = (globalThis as unknown as { SasHost?: HostBridge }).SasHost;
    if (host?.secureStore) return host.secureStore.set(k, v);
    if (v === null) mem.delete(k); else mem.set(k, v);
  },
};
