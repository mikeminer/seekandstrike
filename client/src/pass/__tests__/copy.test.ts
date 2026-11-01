import { describe, expect, it } from 'vitest';
import { PASS_COPY } from '../ui/copy';
import { DETAILS_COPY } from '../ui/details';
import { errorText } from '../ui/view';
import type { FlowError } from '../flow';

const WALLET = ['AUTH_FAILED', 'DECLINED', 'WALLET_CANCELLED', 'BUSY', 'NOT_FOREGROUND', 'OUTCOME_UNKNOWN', 'NO_WALLET', 'LOOPBACK_DENIED', 'WRONG_ACCOUNT', 'UNSUPPORTED'] as const;

describe('pass copy', () => {
  it('it/en have the same keys and no empty strings', () => {
    for (const c of [PASS_COPY, DETAILS_COPY]) {
      expect(Object.keys(c.it).sort()).toEqual(Object.keys(c.en).sort());
      for (const v of [...Object.values(c.it), ...Object.values(c.en)]) expect(v.trim().length).toBeGreaterThan(0);
    }
  });
  it('every failure has a localized sentence', () => {
    const errs: FlowError[] = [
      ...WALLET.map((failure) => ({ kind: 'wallet', failure }) as FlowError),
      ...Array.from({ length: 15 }, (_, i) => ({ kind: 'chain', failure: { kind: 'fridge', code: 6000 + i } }) as FlowError),
      { kind: 'chain', failure: { kind: 'slippage' } }, { kind: 'chain', failure: { kind: 'insufficient-sol' } },
      { kind: 'chain', failure: { kind: 'blockhash' } }, { kind: 'chain', failure: { kind: 'program', program: 'x', code: 6004 } },
      { kind: 'chain', failure: { kind: 'other', detail: 'x' } },
      { kind: 'rpc' }, { kind: 'storage' }, { kind: 'ids-full' }, { kind: 'validation', reason: 'r' },
    ];
    const seen = new Set<string>();
    for (const e of errs) {
      const s = errorText(e);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(8);
      expect(s).not.toMatch(/\{\w+\}|undefined/);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(25);
  });
  it('the player never reads the technical words; Details names the pass token, the pool and the 2% fee', () => {
    const tech = /SWANGY|PASTA|timelock|lock|Meteora|pool|mint/i;
    for (const lang of ['it', 'en'] as const) {
      for (const [k, v] of Object.entries(PASS_COPY[lang])) expect(`${k}: ${v}`).not.toMatch(tech);
    }
    expect(DETAILS_COPY.en.fee).toBe('When your pass ends and your PASTA leaves the program, the 2% fee defined by the program applies.');
    expect(DETAILS_COPY.it.fee).toBe('Quando il tuo pass termina e il tuo PASTA esce dal programma, si applica la commissione del 2% prevista dal programma.');
    expect(PASS_COPY.it.offer).toBe('Ottieni il Daily Pass — 0,01 SOL per 1 giorno');
    expect(PASS_COPY.en.offer).toBe('Get the Daily Pass — 0.01 SOL for 1 day');
  });
});
