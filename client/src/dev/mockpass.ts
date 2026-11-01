import { MockChainRpc } from '../pass/mockchain';
import { MockAdapter, type MockScript } from '../pass/wallet/mock';
import type { PassFlow } from '../pass/flow';
import type { Rpc } from '../pass/rpc';
import type { WalletChoice } from '../pass/ui/view';

/**
 * DEV ONLY (imported behind __DEV_PASS_BYPASS__): `?mockpass=ok|activate|<WalletFailure>`.
 * The mock wallet never signs; the mock chain never broadcasts: "sent" transactions are only
 * simulated against mainnet (read-only) and overlaid on later reads.
 */
const SUBJECT = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

export function mockPass(rpc: Rpc, script: string, wallet: string | null) {
  const chain = new MockChainRpc(rpc);
  const adapter = new MockAdapter(wallet || SUBJECT, (script || 'ok') as MockScript, 700);
  adapter.onSent = (tx, sig) => chain.apply(tx, sig, adapter.address);
  const activate = script === 'activate';
  return {
    rpc: chain as Rpc,
    forceTwoTx: activate,
    wallets: [{ label: adapter.label, kind: 'mock', make: () => adapter }] as WalletChoice[],
    attach(flow: PassFlow): void {
      flow.onChange((v) => {
        // Activate demo: the second transaction's blockhash "expires", then Activate lands.
        if (activate && v.step === 'review') chain.heightBump = 1_000;
        if (activate && v.step === 'activate') adapter.script = 'ok';
      });
    },
  };
}
