/**
 * Mainnet READ-ONLY verification of the Daily Pass purchase (0.01 SOL -> PASTA in the Meteora DAMM v2 pool -> one-day lock,
 * ONE transaction). Only getters and simulateTransaction (sigVerify: false) are used. Nothing is signed or sent;
 * the "wallet" is a public address used as a simulation subject only.
 * Run: npm run sim
 */
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible' };
import { PacedRpc } from './helpers';
import { resolveRoute, type DammRoute } from '../meteora';
import { simQuoter } from '../quote';
import { computeBuffer } from '../math';
import { compile, plan, txSize, type PurchaseIntent } from '../txbuilder';
import { validateTransaction } from '../validator';
import { decodeLock, lockPda } from '../fridge';
import { b64ToBytes, bytesToB64 } from '../bytes';
import { getLatestBlockhash, simulate } from '../rpc';
import { DEFAULT_SLIPPAGE_BPS, NOMINAL_LAMPORTS, PASS_MINT, PASS_SECONDS } from '../constants';
import { PublicKey } from '@solana/web3.js';

const SUBJECT = process.env.SIM_WALLET ?? '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const rpc = new PacedRpc();
const out: Record<string, unknown> = { ranAt: new Date().toISOString(), rpc: 'https://api.mainnet-beta.solana.com (read-only)', subject: SUBJECT };
let route: DammRoute;

afterAll(() => {
  mkdirSync('docs/sim', { recursive: true });
  writeFileSync('docs/sim/mainnet-sim-results.json', JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
});

describe('Daily Pass in PASTA, single transaction (read-only)', () => {
  it('resolves the pool', async () => {
    const r = await resolveRoute(rpc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    route = r.route;
    out.route = { pool: r.route.pool.toBase58(), vaults: [r.route.tokenAVault.toBase58(), r.route.tokenBVault.toBase58()] };
  });

  it('quotes 0.01 SOL by simulation, builds the one transaction, validates it and simulates it end to end', async () => {
    const sim = simQuoter(rpc, SUBJECT, route, 0n, false);
    const buf = await computeBuffer(sim, DEFAULT_SLIPPAGE_BPS);
    expect(buf.ok).toBe(true);
    if (!buf.ok) return;
    const b = buf.value;
    expect(b.amountIn).toBe(NOMINAL_LAMPORTS);
    const bh = await getLatestBlockhash(rpc);
    const nowS = Math.floor(Date.now() / 1000);
    const intent: PurchaseIntent = {
      wallet: SUBJECT, route, wsolExists: false, amountIn: b.amountIn, minOut: b.minOut, target: b.target,
      lockId: 64n, unlockAt: BigInt(nowS + PASS_SECONDS), cuPrice: 0, blockhash: bh.blockhash,
    };
    const p = plan(intent);
    expect(p.mode).toBe('single');
    const tx = p.txs[0];
    expect(validateTransaction(tx.serialize(), 'single', intent, nowS)).toEqual({ ok: true });
    const [lock] = lockPda(new PublicKey(SUBJECT), new PublicKey(PASS_MINT), 64n);
    const r = await simulate(rpc, bytesToB64(tx.serialize()), [lock.toBase58()], true);
    out.simulation = { err: r.err, unitsConsumed: (r as { unitsConsumed?: number }).unitsConsumed ?? null, bytes: txSize(compile('single', intent)) };
    expect(r.err).toBeNull();
    const info = r.accounts?.[0];
    const l = info ? decodeLock(b64ToBytes(info.data[0])) : null;
    expect(l).not.toBeNull();
    expect(l!.amount).toBe(b.minOut);
    expect(l!.unlockAt).toBe(intent.unlockAt);
    out.result = { spentLamports: b.amountIn, expectedPastaRaw: b.expectedOut, lockedPastaRaw: l!.amount, slippageBps: b.slippageBps };
  }, 120_000);
});
