import { passRpcEndpoints } from '@shared/config';
import { PassFlow } from '../flow';
import { PendingStore, type KV } from '../pending';
import { HttpRpc, type Rpc } from '../rpc';
import { isAndroid, WalletSession } from '../wallet';
import { initLoopback } from '../wallet/loopback';
import { MwaAdapter } from '../wallet/mwa';
import { compatibleWallets, StandardAdapter } from '../wallet/standard';
import { PassPanel, type WalletChoice } from './view';

export interface PassApp { flow: PassFlow; panel: PassPanel; session: WalletSession; mock: boolean }

/** Real wallets: the Seeker wallet over MWA on Android, wallet-standard wallets everywhere. */
export function realWallets(): WalletChoice[] {
  const out: WalletChoice[] = [];
  if (isAndroid()) out.push({ label: 'Seeker wallet', kind: 'mwa', make: () => new MwaAdapter() });
  for (const w of compatibleWallets()) out.push({ label: w.name, kind: 'standard', make: () => new StandardAdapter(w) });
  return out;
}

const memoryKv = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

/**
 * Build the Daily Pass (flow + panel). `?mockpass=` is a DEV-only mock wallet over a read-only
 * mainnet overlay; in release builds the branch and its module are compiled out.
 */
export async function createPass(params: URLSearchParams, onGate: (open: boolean) => void): Promise<PassApp> {
  // DEV only: `?devrpc=http://localhost:8787/rpc` points at a local `wrangler dev` proxy.
  const devRpc = __DEV_PASS_BYPASS__ ? params.get('devrpc') : null;
  const rpc: Rpc = new HttpRpc({ endpoints: devRpc ? [devRpc, ...passRpcEndpoints()] : passRpcEndpoints() });
  const session = new WalletSession();
  if (__DEV_PASS_BYPASS__ && params.has('mockpass')) {
    const m = await import('../../dev/mockpass');
    const dev = m.mockPass(rpc, params.get('mockpass') ?? 'ok', params.get('mockwallet'));
    const flow = new PassFlow({ rpc: dev.rpc, session, store: new PendingStore(memoryKv()), forceTwoTx: dev.forceTwoTx });
    dev.attach(flow);
    const panel = new PassPanel({ flow, session, wallets: () => dev.wallets, onGate });
    return { flow, panel, session, mock: true };
  }
  void initLoopback();
  const flow = new PassFlow({ rpc, session });
  const panel = new PassPanel({ flow, session, wallets: realWallets, onGate });
  return { flow, panel, session, mock: false };
}
