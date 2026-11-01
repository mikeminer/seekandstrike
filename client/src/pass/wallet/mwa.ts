import '../polyfill';
import { Buffer } from 'buffer';
import { PublicKey, type VersionedTransaction } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  SolanaMobileWalletAdapterError, SolanaMobileWalletAdapterErrorCode,
  SolanaMobileWalletAdapterProtocolError, SolanaMobileWalletAdapterProtocolErrorCode,
} from '@solana-mobile/mobile-wallet-adapter-protocol';
import { WALLET_IDENTITY } from '@shared/config';
import { sigToB58 } from '../sig';
import { secureStore, type ConnectOutcome, type SendOutcome, type SignOutcome, type WalletAdapter, type WalletFailure } from './types';

const CHAIN = 'solana:mainnet';
const TOKEN_KEY = 'mwa.auth';
const identity = { name: WALLET_IDENTITY.name, uri: WALLET_IDENTITY.uri, icon: WALLET_IDENTITY.icon };

function b64ToB58(a: string): string {
  return new PublicKey(Buffer.from(a, 'base64')).toBase58();
}

/** Diagnostic breadcrumbs for logcat (no addresses, tokens or payloads). */
function trace(msg: string): void { console.info(`[mwa] ${msg}`); }

/** A session that never completes must not leave the UI on "connecting" forever (the wallet may be closed or dead). */
const CONNECT_TIMEOUT_MS = 90_000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_TIMEOUT, 'wallet session timed out')), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

type Phase = 'association' | 'authorized' | 'handed-off';

export function classifyMwaError(e: unknown, phase: Phase): WalletFailure | 'METHOD_NOT_FOUND' {
  if (e instanceof SolanaMobileWalletAdapterProtocolError) {
    const c = e.code as number;
    if (c === -32601) return phase === 'handed-off' ? 'METHOD_NOT_FOUND' : 'UNSUPPORTED';
    if (c === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED) return 'AUTH_FAILED';
    if (c === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED) return 'DECLINED';
    // NOT_SUBMITTED can follow a partial submission of a batch: never treat it as definitive.
    return phase === 'handed-off' ? 'OUTCOME_UNKNOWN' : 'WALLET_CANCELLED';
  }
  if (e instanceof SolanaMobileWalletAdapterError) {
    switch (e.code) {
      case SolanaMobileWalletAdapterErrorCode.ERROR_WALLET_NOT_FOUND: return 'NO_WALLET';
      case SolanaMobileWalletAdapterErrorCode.ERROR_LOOPBACK_ACCESS_BLOCKED: return 'LOOPBACK_DENIED';
      case SolanaMobileWalletAdapterErrorCode.ERROR_BROWSER_NOT_SUPPORTED: return 'NO_WALLET';
      case SolanaMobileWalletAdapterErrorCode.ERROR_ASSOCIATION_CANCELLED:
        return phase === 'handed-off' ? 'OUTCOME_UNKNOWN' : 'WALLET_CANCELLED';
      default:
        return phase === 'handed-off' ? 'OUTCOME_UNKNOWN' : 'WALLET_CANCELLED';
    }
  }
  return phase === 'handed-off' ? 'OUTCOME_UNKNOWN' : 'WALLET_CANCELLED';
}

export class MwaAdapter implements WalletAdapter {
  readonly kind = 'mwa' as const;
  readonly label = 'Seeker wallet';

  async connect(): Promise<ConnectOutcome> {
    let phase = 'association' as Phase;
    try {
      const cached = await secureStore.get(TOKEN_KEY);
      trace('connect: opening session');
      const res = await withTimeout(transact(async (w) => {
        trace('connect: session open, asking authorization');
        const auth = await w.authorize({ chain: CHAIN, identity, ...(cached ? { auth_token: cached } : {}) });
        trace('connect: authorized');
        phase = 'authorized';
        return auth;
      }), CONNECT_TIMEOUT_MS);
      trace('connect: session closed');
      await secureStore.set(TOKEN_KEY, res.auth_token);
      const first = res.accounts[0];
      if (!first) return { ok: false, failure: 'AUTH_FAILED' };
      return { ok: true, address: b64ToB58(first.address) };
    } catch (e) {
      const f = classifyMwaError(e, phase);
      if (f === 'AUTH_FAILED') await secureStore.set(TOKEN_KEY, null);
      return { ok: false, failure: f === 'METHOD_NOT_FOUND' ? 'UNSUPPORTED' : f };
    }
  }

  async signAndSend(address: string, txs: VersionedTransaction[], onHandoff: () => void): Promise<SendOutcome> {
    let phase = 'association' as Phase;
    try {
      const cached = await secureStore.get(TOKEN_KEY);
      return await transact(async (w) => {
        const auth = await w.authorize({ chain: CHAIN, identity, ...(cached ? { auth_token: cached } : {}) });
        await secureStore.set(TOKEN_KEY, auth.auth_token);
        if (!auth.accounts.some((a) => b64ToB58(a.address) === address)) {
          return { ok: false, failure: 'WRONG_ACCOUNT', afterHandoff: false } as SendOutcome;
        }
        phase = 'authorized';
        onHandoff();
        phase = 'handed-off';
        try {
          const sigs = await w.signAndSendTransactions({
            transactions: txs, commitment: 'confirmed', waitForCommitmentToSendNextTransaction: txs.length > 1,
          });
          return { ok: true, signatures: sigs } as SendOutcome;
        } catch (e) {
          // Only an explicit −32601 (method not found) BEFORE any send allows the sign-only path.
          if (classifyMwaError(e, 'handed-off') !== 'METHOD_NOT_FOUND') throw e;
          const signed = await w.signTransactions({ transactions: txs });
          // The wallet must sign exactly the reviewed message; anything else is never broadcast.
          signed.forEach((t, i) => {
            const a = t.message.serialize();
            const b = txs[i]!.message.serialize();
            if (a.length !== b.length || a.some((x, j) => x !== b[j])) throw new Error('wallet changed the transaction');
          });
          const bytes = signed.map((t) => t.serialize());
          const signatures = signed.map((t) => sigToB58(t.signatures[0]!));
          return { ok: true, signed: bytes, signatures } as SendOutcome;
        }
      });
    } catch (e) {
      const f = classifyMwaError(e, phase);
      if (f === 'AUTH_FAILED') await secureStore.set(TOKEN_KEY, null);
      return { ok: false, failure: f === 'METHOD_NOT_FOUND' ? 'OUTCOME_UNKNOWN' : f, afterHandoff: phase === 'handed-off' };
    }
  }

  async signMessage(address: string, message: Uint8Array): Promise<SignOutcome> {
    let phase = 'association' as Phase;
    try {
      const cached = await secureStore.get(TOKEN_KEY);
      return await transact(async (w) => {
        const auth = await w.authorize({ chain: CHAIN, identity, ...(cached ? { auth_token: cached } : {}) });
        await secureStore.set(TOKEN_KEY, auth.auth_token);
        const account = auth.accounts.find((a) => b64ToB58(a.address) === address);
        if (!account) return { ok: false, failure: 'WRONG_ACCOUNT' } as SignOutcome;
        phase = 'authorized';
        const [signed] = await w.signMessages({ addresses: [account.address], payloads: [message] });
        // MWA returns the signed payload: the message followed by its 64-byte signature.
        if (!signed) return { ok: false, failure: 'UNSUPPORTED' } as SignOutcome;
        const prefixed = signed.length === message.length + 64 && message.every((b, i) => signed[i] === b);
        if (!prefixed && signed.length !== 64) return { ok: false, failure: 'UNSUPPORTED' } as SignOutcome;
        return { ok: true, signature: signed.slice(signed.length - 64) } as SignOutcome;
      });
    } catch (e) {
      const f = classifyMwaError(e, phase);
      if (f === 'AUTH_FAILED') await secureStore.set(TOKEN_KEY, null);
      return { ok: false, failure: f === 'METHOD_NOT_FOUND' ? 'UNSUPPORTED' : f === 'OUTCOME_UNKNOWN' ? 'WALLET_CANCELLED' : f };
    }
  }

  async disconnect(): Promise<void> {
    await secureStore.set(TOKEN_KEY, null);
  }
}

