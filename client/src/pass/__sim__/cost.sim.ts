/** Read-only: simulated outflow of the one transaction vs the modelled total, for a funded public address (subject only). */
import { it } from 'vitest';
(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible' };
import { PublicKey } from '@solana/web3.js';
import { PacedRpc } from './helpers';
import { resolveRoute } from '../meteora';
import { compile } from '../txbuilder';
import { simulate, getLatestBlockhash, getRent, getMultipleAccounts } from '../rpc';
import { ata, lockPda } from '../fridge';
import { bytesToB64 } from '../bytes';
import { LOCK_ACCOUNT_SIZE, PASS_MINT, PASS_SECONDS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from '../constants';

for (const W of ['GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ', '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1']) {
  it('diag ' + W, async () => {
    const rpc = new PacedRpc();
    const r = await resolveRoute(rpc); if (!r.ok) throw new Error('route');
    const [pa, wa] = await getMultipleAccounts(rpc, [ata(new PublicKey(W), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58(), ata(new PublicKey(W), new PublicKey(WSOL_MINT), TOKEN_PROGRAM).toBase58()]);
    const bh = await getLatestBlockhash(rpc);
    const now = Math.floor(Date.now() / 1000);
    const intent = { wallet: W, route: r.route, wsolExists: !!wa, amountIn: 10_000_000n, minOut: 200_000_000_000n, target: 1n, lockId: 64n, unlockAt: BigInt(now + PASS_SECONDS), cuPrice: 0, blockhash: bh.blockhash };
    const tx = compile('single', intent);
    const userAta = ata(new PublicKey(W), new PublicKey(PASS_MINT), TOKEN_2022_PROGRAM).toBase58();
    const [lock] = lockPda(new PublicKey(W), new PublicKey(PASS_MINT), 64n);
    const sim = await simulate(rpc, bytesToB64(tx.serialize()), [W, userAta, lock.toBase58()], false);
    const taken = BigInt(sim.preBalances![0]!) - BigInt(sim.accounts![0]!.lamports);
    const space = sim.accounts![1]?.space ?? 0;
    const rent = await getRent(rpc, space);
    const lockRent = await getRent(rpc, LOCK_ACCOUNT_SIZE);
    const model = 10_000_000n + lockRent + rent + (pa ? 0n : rent) + 5_000n;
    console.log('DIAG', W.slice(0, 6), 'hasPassAta', !!pa, 'hasWsol', !!wa, 'err', JSON.stringify(sim.err), 'taken', taken, 'model', model, 'diff', taken - model, 'ataSpace', space);
  }, 60000);
}
