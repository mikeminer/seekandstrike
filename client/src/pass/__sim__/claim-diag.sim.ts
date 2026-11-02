// READ-ONLY diagnosis of "Riporta nel wallet": builds the same claim the app builds for the owner's
// ended lock and SIMULATES it (sigVerify off). PacedRpc refuses sendTransaction. Nothing is signed.
import { describe, it } from 'vitest';
import { PacedRpc } from './helpers';
import { readLocks } from '../reader';
import { buildClaim } from '../claim';
import { PASS_MINT } from '../constants';

const WALLET = process.env.SIM_WALLET ?? '97g84xDhkSL1uQxVsdVpK7Y76Lt18H92TbZfERgZYbDD';

class LoggingRpc extends PacedRpc {
  sims: unknown[] = [];
  override async call<T>(method: string, params: unknown[]): Promise<T> {
    const r = await super.call<T>(method, params);
    if (method === 'simulateTransaction') this.sims.push(r);
    return r;
  }
}

describe('claim diagnosis (read-only)', () => {
  it('simulates the claim of every ended lock of the pass mint', async () => {
    const rpc = new LoggingRpc();
    const read = await readLocks(rpc, WALLET, [1]);
    console.log('PASS_MINT', PASS_MINT, 'read ok', read.ok);
    if (!read.ok) return;
    const now = Math.floor(Date.now() / 1000);
    for (const lock of read.snapshot.locks) {
      console.log('LOCK', lock.address, 'id', lock.lockId, 'amount', String(lock.amount), 'vault', String(lock.vaultAmount), 'unlockAt', String(lock.unlockAt), 'ended', Number(lock.unlockAt) <= now);
      const b = await buildClaim(rpc, WALLET, lock, now);
      console.log('BUILD', JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 600));
    }
    for (const s of rpc.sims) {
      const v = (s as { value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }).value;
      console.log('SIM err', JSON.stringify(v.err), 'units', v.unitsConsumed);
      for (const l of v.logs ?? []) console.log('  ', l);
    }
  });
});
