import { describe, expect, it } from 'vitest';
import { applySlippage, ceilTo, computeBuffer, nextSlippage } from '../math';
import { NOMINAL_LAMPORTS } from '../constants';

/** Constant-product-like monotone simulator with fees (raw units). */
const amm = (x: bigint, y: bigint, feeBps = 125n) => async (a: bigint) => {
  const ain = (a * (10_000n - feeBps)) / 10_000n;
  return (y * ain) / (x + ain);
};

describe('purchase math (owner rule 2026-10-29: always exactly 0.01 SOL)', () => {
  it('slippage and rounding are exact integer ops', () => {
    expect(applySlippage(1_000_000n, 200)).toBe(980_000n);
    expect(applySlippage(999n, 200)).toBe(979n);
    expect(ceilTo(10_230_001n, 1_000n)).toBe(10_231_000n);
    expect(() => applySlippage(1n, 10_000)).toThrow();
  });
  it('always swaps exactly 0.01 SOL, whatever the slippage or the pool depth', async () => {
    for (const slip of [100, 200, 500, 600]) {
      for (const [x, y] of [[5_000_000_000_000n, 800_000_000_000_000_000n], [50_908_495n, 1_278_664_087_665n]] as const) {
        const r = await computeBuffer(amm(x, y), slip);
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        expect(r.value.amountIn).toBe(NOMINAL_LAMPORTS);
        expect(r.value.minOut).toBe(applySlippage(r.value.target, slip));
        expect(r.value.minOut).toBeGreaterThan(0n);
      }
    }
  });
  it('the amount of tokens follows the market: a thinner pool gives a different pass amount, never a different price in SOL', async () => {
    const deep = await computeBuffer(amm(5_000_000_000_000n, 800_000_000_000_000_000n), 200);
    const thin = await computeBuffer(amm(50_908_495n, 1_278_664_087_665n), 200);
    if (!deep.ok || !thin.ok) throw new Error('expected ok');
    expect(thin.value.amountIn).toBe(deep.value.amountIn);
    expect(thin.value.minOut).not.toBe(deep.value.minOut);
  });
  it('fails closed on no output', async () => {
    expect(await computeBuffer(async () => 0n, 200)).toEqual({ ok: false, reason: 'no-output' });
    expect(await computeBuffer(async () => 1n, 9_999)).toEqual({ ok: false, reason: 'no-output' });
  });
  it('slippage retry steps +25 bps up to the 600 bps cap', () => {
    expect(nextSlippage(200)).toBe(225);
    expect(nextSlippage(575)).toBe(600);
    expect(nextSlippage(600)).toBeNull();
  });
});
