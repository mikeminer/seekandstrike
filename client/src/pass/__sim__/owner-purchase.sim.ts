/**
 * READ-ONLY rehearsal of the owner's first Daily Pass purchase, through the REAL app flow (PassFlow):
 * market read → quote by simulation → review → fresh build → JS validator → simulateTransaction (sigVerify off).
 * The "wallet" is a stub that is handed the exact unsigned transaction and DECLINES: nothing is signed or sent
 * (PacedRpc also refuses sendTransaction). Run:
 *   SIM_WALLET=<address> npx vitest run -c vitest.sim.config.ts client/src/pass/__sim__/owner-purchase.sim.ts --reporter=verbose
 */
import { it } from 'vitest';
(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible' };
import type { VersionedTransaction } from '@solana/web3.js';
import { PacedRpc, memoryKv } from './helpers';
import { PassFlow } from '../flow';
import { WalletSession } from '../wallet';
import { PendingStore } from '../pending';
import type { ConnectOutcome, SendOutcome, WalletAdapter } from '../wallet/types';
import { getBalance, simulate } from '../rpc';
import { bytesToB64 } from '../bytes';
import { DAMM_PROGRAM, FRIDGE_PROGRAM } from '../constants';

const WALLET = process.env.SIM_WALLET ?? '97g84xDhkSL1uQxVsdVpK7Y76Lt18H92TbZfERgZYbDD';
const sol = (l: bigint | number): string => (Number(l) / 1e9).toFixed(9);

class DecliningWallet implements WalletAdapter {
  readonly kind = 'mock' as const;
  readonly label = 'rehearsal (never signs)';
  handed: VersionedTransaction[] = [];
  async connect(): Promise<ConnectOutcome> { return { ok: true, address: WALLET }; }
  async signAndSend(_a: string, txs: VersionedTransaction[]): Promise<SendOutcome> {
    this.handed = txs; // exactly what the real wallet would show
    return { ok: false, failure: 'DECLINED', afterHandoff: false };
  }
  async disconnect(): Promise<void> {}
}

it('owner purchase rehearsal (read-only)', async () => {
  const rpc = new PacedRpc();
  const flow = new PassFlow({ rpc, session: new WalletSession(), store: new PendingStore(memoryKv()) });
  const steps: string[] = [];
  flow.onChange((v) => steps.push(v.step));
  const w = new DecliningWallet();
  await flow.connect(w);
  console.log('WALLET', WALLET, 'balance', sol(await getBalance(rpc, WALLET)), 'SOL', 'pass state:', flow.view.step);
  const now = Math.floor(Date.now() / 1000);
  console.log('STATUS', JSON.stringify(flow.status, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)).slice(0, 600));
  for (const l of flow.snapshot?.locks ?? []) console.log('LOCK', l.address, 'mint', (l as { mint?: string }).mint ?? '?', 'id', String(l.lockId), 'amount', String(l.amount), 'unlockAt', new Date(Number(l.unlockAt) * 1000).toISOString(), Number(l.unlockAt) > now ? 'OPEN' : 'ended');
  await flow.startPurchase();
  const v = flow.view;
  if (v.step === 'insufficient') {
    console.log('RESULT insufficient: the app asks for at least', sol(v.needLamports), 'SOL; wallet has', sol(v.balance));
    console.log('STEPS', steps.join(' → '));
    return;
  }
  if (v.step !== 'review') { console.log('RESULT stopped at', v.step, JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))); return; }
  const r = v.review;
  console.log('REVIEW total', sol(r.totalLamports), 'SOL · swap in', sol(r.buffer.amountIn), '· network fee max', sol(r.feeLamports),
    '· back at end', sol(r.costs.returned), '· first-time setup', sol(r.costs.firstTimeRent + r.costs.buybackRent + r.costs.accumulatorRent),
    '· mode', r.mode, '· slippage bps', r.buffer.slippageBps, '· min pass tokens (raw)', r.buffer.minOut.toString());
  await flow.confirm();
  console.log('AFTER CONFIRM view:', flow.view.step, JSON.stringify((flow.view as { error?: unknown }).error ?? null), 'handed txs:', w.handed.length);
  for (const [i, tx] of w.handed.entries()) {
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const progs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]!);
    console.log(`TX${i} bytes`, tx.serialize().length, 'signers', tx.message.header.numRequiredSignatures, 'fee payer', keys[0],
      'programs', [...new Set(progs)].map((p) => (p === FRIDGE_PROGRAM ? 'Fridge' : p === DAMM_PROGRAM ? 'Meteora DAMM v2' : p)).join(', '));
    const s = await simulate(rpc, bytesToB64(tx.serialize()), [WALLET], true);
    console.log(`TX${i} SIMULATION err`, JSON.stringify(s.err), 'units', (s as { unitsConsumed?: number }).unitsConsumed ?? '?');
    const logs = s.logs ?? [];
    console.log(`TX${i} FRIDGE`, logs.filter((x) => x.includes(FRIDGE_PROGRAM) || /Program log: (Instruction: (Lock|Deposit)|Error)/.test(x)).join(' | ').slice(0, 600));
  }
  console.log('STEPS', steps.join(' → '));
}, 240_000);
