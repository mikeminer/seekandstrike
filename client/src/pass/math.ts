import { MAX_BUFFER_BPS, NOMINAL_LAMPORTS, SLIPPAGE_RETRY_STEP_BPS } from './constants';

/** All amounts are bigint raw units. No floating point. */
export const BPS = 10_000n;

export function applySlippage(out: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error('bad slippage');
  return (out * (BPS - BigInt(slippageBps))) / BPS;
}
export function ceilTo(v: bigint, step: bigint): bigint {
  return ((v + step - 1n) / step) * step;
}

export type Simulate = (amountIn: bigint) => Promise<bigint>;

export interface BufferResult {
  /** T = sim(N): the pass-token amount 0.01 SOL buys right now. */
  target: bigint;
  /** Lamports swapped: always exactly N (0.01 SOL), never more. */
  amountIn: bigint;
  /** Expected tokens for N (simulation). */
  expectedOut: bigint;
  /** minOut = floor(T × (1 − slippage)): the guaranteed amount, and exactly what the pass locks. */
  minOut: bigint;
  slippageBps: number;
}

/**
 * Owner rule (2026-10-29): the pass always costs exactly 0.01 SOL, nothing more, nothing less. The amount of pass
 * token follows the market, so the lock holds the guaranteed minimum of that one simulated purchase; slippage only
 * lowers what the swap must return (the transaction fails instead of paying more).
 */
export async function computeBuffer(sim: Simulate, slippageBps: number, nominal = NOMINAL_LAMPORTS): Promise<
  { ok: true; value: BufferResult } | { ok: false; reason: 'market-moving' | 'no-output' }
> {
  const target = await sim(nominal);
  if (target <= 0n) return { ok: false, reason: 'no-output' };
  const minOut = applySlippage(target, slippageBps);
  if (minOut <= 0n) return { ok: false, reason: 'no-output' };
  return { ok: true, value: { target, amountIn: nominal, expectedOut: target, minOut, slippageBps } };
}

export function nextSlippage(current: number): number | null {
  const n = current + SLIPPAGE_RETRY_STEP_BPS;
  return n > MAX_BUFFER_BPS ? null : n;
}
