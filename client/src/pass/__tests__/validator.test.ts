import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { compile, instructionsFor, plan, txSize, type TxKind } from '../txbuilder';
import { validateTransaction } from '../validator';
import { setCuLimitIx, setCuPriceIx } from '../tokenIx';
import { PASS_SECONDS, PASS_MINT } from '../constants';
import { BLOCKHASH, NOW, WALLET, intent } from './fixtures';

function raw(kind: TxKind, it = intent()): Uint8Array {
  return compile(kind, it).serialize();
}
function rawFrom(ixs: TransactionInstruction[], payer = WALLET, luts: AddressLookupTableAccount[] = []): Uint8Array {
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message(luts);
  return new VersionedTransaction(msg).serialize();
}
const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
const bad = (r: { ok: boolean; reason?: string }, re?: RegExp) => {
  expect(r.ok).toBe(false);
  if (re && !r.ok) expect(r.reason).toMatch(re);
};

describe('valid fixtures', () => {
  it('single, swap and lock transactions validate', () => {
    ok(validateTransaction(raw('single'), 'single', intent(), NOW));
    ok(validateTransaction(raw('swap'), 'swap', intent(), NOW));
    ok(validateTransaction(raw('lock'), 'lock', intent(), NOW));
  });
  it('with a priority fee', () => {
    const it2 = intent({ cuPrice: 5_000 });
    const p = plan(it2);
    if (p.mode === 'single') ok(validateTransaction(p.txs[0].serialize(), 'single', it2, NOW));
    else {
      ok(validateTransaction(p.txs[0].serialize(), 'swap', it2, NOW));
      ok(validateTransaction(p.txs[1].serialize(), 'lock', it2, NOW));
    }
  });
  it('an existing wSOL account is used as is (no create, no close) and the variants do not cross-validate', () => {
    const keep = intent({ wsolExists: true });
    ok(validateTransaction(raw('single', keep), 'single', keep, NOW));
    ok(validateTransaction(raw('swap', keep), 'swap', keep, NOW));
    const progs = compile('single', keep).message.compiledInstructions.length;
    expect(progs).toBe(compile('single', intent()).message.compiledInstructions.length - 2);
    bad(validateTransaction(raw('single'), 'single', keep, NOW));
    bad(validateTransaction(raw('single', keep), 'single', intent(), NOW));
  });
  it('the swap + pass lock is ONE transaction and fits 1232 bytes', () => {
    expect(plan(intent({ cuPrice: 1 })).mode).toBe('single');
    expect(txSize(compile('single', intent({ cuPrice: 1 })))).toBeLessThanOrEqual(1232);
  });
});

describe('field tampering (bytes built from one intent, validated against the reviewed one)', () => {
  const cases: [string, Partial<ReturnType<typeof intent>>, RegExp][] = [
    ['amountIn', { amountIn: 10_232_000n }, /nominal|swap input|data mismatch|account/],
    ['minOut', { minOut: 205_000_000_001n, target: 209_000_000_000n }, /guaranteed|pass amount|swap minimum|data/],
    ['lockId', { lockId: 4n }, /account|lock id/],
    ['unlockAt', { unlockAt: BigInt(NOW + PASS_SECONDS + 1) }, /end time/],
    ['cuPrice', { cuPrice: 7 }, /instruction count|data/],
    ['blockhash', { blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi' }, /blockhash/],
    ['wallet', { wallet: Keypair.generate().publicKey.toBase58() }, /signer/],
  ];
  for (const [name, patch, re] of cases) {
    it(`rejects a different ${name}`, () => {
      bad(validateTransaction(raw('single'), 'single', intent(patch), NOW), re);
    });
  }
  it('rejects the wrong kind', () => {
    bad(validateTransaction(raw('swap'), 'single', intent(), NOW));
    bad(validateTransaction(raw('lock'), 'swap', intent(), NOW));
  });
});

describe('policy bounds (even when the bytes agree with the intent)', () => {
  const both = (p: Partial<ReturnType<typeof intent>>) => { const it2 = intent(p); return validateTransaction(raw('single', it2), 'single', it2, NOW); };
  it('the amount is exactly 0.01 SOL: neither less nor more', () => {
    bad(both({ amountIn: 9_999_000n }), /nominal/);
    bad(both({ amountIn: 10_000_001n }), /nominal/);
    bad(both({ amountIn: 10_600_000n }), /nominal/);
    ok(both({ amountIn: 10_000_000n }));
  });
  it('a pass amount of zero is refused (builder) and the guaranteed amount may follow the market', () => {
    expect(() => both({ minOut: 0n })).toThrow();
    ok(both({ minOut: 1n, target: 1n }));
    ok(both({ minOut: 900_000_000_000n, target: 1_000_000_000_000n }));
  });
  it('priority fee too high', () => bad(both({ cuPrice: 200_001 }), /priority/));
  it('lock id 0 (builder refuses) and 65 (validator refuses)', () => { expect(() => both({ lockId: 0n })).toThrow(); bad(both({ lockId: 65n }), /lock id/); });
  it('unlock outside the signing window', () => {
    bad(both({ unlockAt: BigInt(NOW + PASS_SECONDS - 1801) }), /window/);
    bad(both({ unlockAt: BigInt(NOW + PASS_SECONDS + 301) }), /window/);
    ok(both({ unlockAt: BigInt(NOW + PASS_SECONDS - 1800) }));
  });
});

describe('structural attacks', () => {
  const it0 = intent();
  const base = () => instructionsFor('single', it0);
  it('extra instruction appended', () => {
    const extra = new TransactionInstruction({ programId: new PublicKey('11111111111111111111111111111111'), keys: [], data: Buffer.from([]) });
    bad(validateTransaction(rawFrom([...base(), extra]), 'single', it0, NOW), /count/);
  });
  it('instruction reordered', () => {
    const ixs = base();
    [ixs[3], ixs[4]] = [ixs[4]!, ixs[3]!];
    bad(validateTransaction(rawFrom(ixs), 'single', it0, NOW));
  });
  it('two compute limits / limit too high', () => {
    const ixs = base();
    ixs[0] = setCuLimitIx(500_000);
    bad(validateTransaction(rawFrom(ixs), 'single', it0, NOW), /compute/);
    const two = [setCuLimitIx(300_000), ...base().slice(0, -1)];
    bad(validateTransaction(rawFrom(two), 'single', it0, NOW));
  });
  it('compute price instruction smuggled in', () => {
    const ixs = [base()[0]!, setCuPriceIx(1), ...base().slice(1, -1)];
    bad(validateTransaction(rawFrom(ixs), 'single', it0, NOW));
  });
  it('account swapped inside the pass instruction (other mint)', () => {
    const ixs = base();
    const last = ixs[ixs.length - 1]!;
    const keys = last.keys.map((k, i) => (i === 1 ? { ...k, pubkey: Keypair.generate().publicKey } : k));
    ixs[ixs.length - 1] = new TransactionInstruction({ programId: last.programId, keys, data: last.data });
    bad(validateTransaction(rawFrom(ixs), 'single', it0, NOW));
  });
  it('writable flag added to a read-only account', () => {
    const ixs = base();
    const last = ixs[ixs.length - 1]!;
    const keys = last.keys.map((k, i) => (i === 1 ? { ...k, isWritable: true } : k));
    ixs[ixs.length - 1] = new TransactionInstruction({ programId: last.programId, keys, data: last.data });
    bad(validateTransaction(rawFrom(ixs), 'single', it0, NOW), /permission/);
  });
  it('second signer', () => {
    const ixs = instructionsFor('lock', it0);
    const other = Keypair.generate().publicKey;
    const last = ixs[ixs.length - 1]!;
    ixs[ixs.length - 1] = new TransactionInstruction({ programId: last.programId, keys: [...last.keys, { pubkey: other, isSigner: true, isWritable: false }], data: last.data });
    bad(validateTransaction(rawFrom(ixs), 'lock', it0, NOW), /signer/);
  });
  it('address lookup table', () => {
    const ixs = instructionsFor('lock', it0);
    const lut = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [new PublicKey(PASS_MINT)] },
    });
    bad(validateTransaction(rawFrom(ixs, WALLET, [lut]), 'lock', it0, NOW), /lookup|accounts|count/);
  });
  it('already signed', () => {
    const r = raw('lock');
    r[1] = 1;
    bad(validateTransaction(r, 'lock', it0, NOW), /signed/);
  });
  it('trailing byte', () => {
    const r = raw('lock');
    const t = new Uint8Array(r.length + 1); t.set(r);
    bad(validateTransaction(t, 'lock', it0, NOW), /trailing/);
  });
  it('truncation at every length', () => {
    const r = raw('lock');
    for (let n = 0; n < r.length; n++) bad(validateTransaction(r.subarray(0, n), 'lock', it0, NOW));
  });
  it('every single byte flip of the message is rejected', () => {
    const r = raw('lock');
    for (let i = 65; i < r.length; i++) {
      const t = r.slice();
      t[i] = t[i]! ^ 0x01;
      const res = validateTransaction(t, 'lock', it0, NOW);
      if (res.ok) throw new Error(`byte ${i} flip accepted`);
    }
  });
  it('random multi-byte fuzz (single tx) is rejected', () => {
    const r = raw('single');
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let k = 0; k < 300; k++) {
      const t = r.slice();
      const n = 1 + (rnd() % 4);
      for (let j = 0; j < n; j++) { const i = 65 + (rnd() % (r.length - 65)); t[i] = t[i]! ^ (1 + (rnd() % 255)); }
      expect(validateTransaction(t, 'single', it0, NOW).ok).toBe(false);
    }
  });
});
