/**
 * Test helpers: a fake read-only chain (Fridge lock accounts and their vaults) behind the `Rpc` interface, and an
 * Ed25519 test wallet. Only used by tests; nothing here is bundled into the Worker.
 */
import { PublicKey } from '@solana/web3.js';
import { bytesToB64, concat, hexBytes, i64le, u64le } from '@pass/bytes';
import { DISC, FLOOR_RAW, FRIDGE_PROGRAM, LOCK_ACCOUNT_SIZE, PASS_MINT, TOKEN_2022_PROGRAM } from '@pass/constants';
import { ata, lockPda } from '@pass/fridge';
import type { AccountInfoB64, Rpc } from '@pass/rpc';

export interface TestWallet {
  address: string;
  sign(text: string): Promise<string>;
}

/** A fresh Ed25519 key pair, addressed like a Solana wallet. */
export async function newWallet(): Promise<TestWallet> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {
    address: new PublicKey(raw).toBase58(),
    async sign(text) {
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(text)));
      return btoa(String.fromCharCode(...sig));
    },
  };
}

export interface LockSpec {
  lockId?: number;
  amount?: bigint;
  /** Unix seconds. */
  createdAt: number;
  unlockAt: number;
  /** Whose lock the account claims to be (default: the wallet that owns it). */
  depositor?: string;
  /** Leave the vault out or empty. */
  vault?: 'ok' | 'missing' | 'empty';
}

const info = (owner: string, data: Uint8Array): AccountInfoB64 => ({ owner, lamports: 1_000_000, data: [bytesToB64(data), 'base64'], executable: false, space: data.length });

/** A day-long lock at the floor amount, created just now. */
export function dayLock(nowS: number, over: Partial<LockSpec> = {}): LockSpec {
  return { createdAt: nowS - 100, unlockAt: nowS - 100 + 86_400, amount: FLOOR_RAW, ...over };
}

export class FakeChain implements Rpc {
  readonly label = 'fake-chain';
  readonly accounts = new Map<string, AccountInfoB64>();
  readonly byWallet = new Map<string, string[]>();
  calls: string[] = [];
  /** When set, every call fails like an unreachable node. */
  down = false;
  /** Artificial latency per call (ms). */
  delayMs = 0;

  addLock(wallet: string, spec: LockSpec): string {
    const w = new PublicKey(wallet);
    const mint = new PublicKey(PASS_MINT);
    const id = BigInt(spec.lockId ?? 1);
    const [pda, bump] = lockPda(w, mint, id);
    const amount = spec.amount ?? FLOOR_RAW;
    const data = concat(hexBytes(DISC.lockAccount), new PublicKey(spec.depositor ?? wallet).toBytes(), mint.toBytes(),
      u64le(amount), i64le(BigInt(spec.createdAt)), i64le(BigInt(spec.unlockAt)), new Uint8Array([bump]), u64le(id));
    if (data.length !== LOCK_ACCOUNT_SIZE) throw new Error('lock layout');
    this.accounts.set(pda.toBase58(), info(FRIDGE_PROGRAM, data));
    const list = this.byWallet.get(wallet) ?? [];
    list.push(pda.toBase58());
    this.byWallet.set(wallet, list);
    if (spec.vault !== 'missing') {
      const v = new Uint8Array(165);
      v.set(mint.toBytes(), 0);
      v.set(pda.toBytes(), 32);
      v.set(u64le(spec.vault === 'empty' ? 0n : amount), 64);
      v[108] = 1;
      this.accounts.set(ata(pda, mint, TOKEN_2022_PROGRAM).toBase58(), info(TOKEN_2022_PROGRAM, v));
    }
    return pda.toBase58();
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    this.calls.push(method);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.down) throw new Error('node unreachable');
    if (method === 'getProgramAccounts') {
      // Deliberately ignores the filters: a sloppy or hostile node may return every lock it knows, and the verifier must not trust that.
      const keys = [...this.accounts.keys()].filter((k) => this.accounts.get(k)!.owner === FRIDGE_PROGRAM);
      return keys.map((pubkey) => ({ pubkey, account: this.accounts.get(pubkey)! })) as T;
    }
    if (method === 'getMultipleAccounts') {
      const keys = params[0] as string[];
      return { context: { slot: 1 }, value: keys.map((k) => this.accounts.get(k) ?? null) } as T;
    }
    if (method === 'getSignaturesForAddress') return [] as T;
    throw new Error(`unexpected RPC method ${method}`);
  }
}
