import { describe, expect, it } from 'vitest';
import { classifyChainError } from '../errors';
import { FRIDGE_PROGRAM, DAMM_PROGRAM } from '../constants';

describe('classifyChainError', () => {
  it('blockhash and insufficient SOL', () => {
    expect(classifyChainError('BlockhashNotFound')).toEqual({ kind: 'blockhash' });
    expect(classifyChainError('InsufficientFundsForRent')).toEqual({ kind: 'insufficient-sol' });
    expect(classifyChainError({ InstructionError: [1, { Custom: 1 }] }, ['Transfer: insufficient lamports 10, need 20'])).toEqual({ kind: 'insufficient-sol' });
  });
  it('pool slippage (cp-amm 6002) is attributed through the logs', () => {
    const logs = [`Program ${DAMM_PROGRAM} invoke [1]`, `Program ${DAMM_PROGRAM} failed: custom program error: 0x1772`];
    expect(classifyChainError({ InstructionError: [4, { Custom: 6002 }] }, logs)).toEqual({ kind: 'slippage' });
  });
  it('pool slippage from the top-level program when there are no logs', () => {
    expect(classifyChainError({ InstructionError: [2, { Custom: 6002 }] }, null, ['a', 'b', DAMM_PROGRAM])).toEqual({ kind: 'slippage' });
  });
  it('Fridge 6000–6014 map to fridge codes; others are program errors', () => {
    const f = (c: number) => classifyChainError({ InstructionError: [0, { Custom: c }] }, [`Program ${FRIDGE_PROGRAM} failed: custom program error: 0x${c.toString(16)}`]);
    expect(f(6000)).toEqual({ kind: 'fridge', code: 6000 });
    expect(f(6014)).toEqual({ kind: 'fridge', code: 6014 });
    expect(f(6015)).toEqual({ kind: 'program', program: FRIDGE_PROGRAM, code: 6015 });
  });
  it('unknown errors stay "other" with a bounded detail', () => {
    const r = classifyChainError({ Weird: 'x'.repeat(500) });
    expect(r.kind).toBe('other');
    if (r.kind === 'other') expect(r.detail.length).toBeLessThanOrEqual(200);
  });
});
