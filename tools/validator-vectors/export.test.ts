/**
 * Writes the shared test vectors for the native (Java) validator:
 * android-host/android/app/src/test/resources/validator-vectors.txt
 * Each line is the TypeScript validator's verdict for a transaction; the Java validator must agree
 * on every line (see android-host/.../pass/VectorRunner.java). Run: npx vitest run tools/validator-vectors
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { compile, instructionsFor, type TxKind } from '../../client/src/pass/txbuilder';
import { validateTransaction } from '../../client/src/pass/validator';
import { setCuLimitIx, setCuPriceIx } from '../../client/src/pass/tokenIx';
import { DAMM_PROGRAM, PASS_SECONDS } from '../../client/src/pass/constants';
import { BLOCKHASH, NOW, WALLET, intent } from '../../client/src/pass/__tests__/fixtures';

type It = ReturnType<typeof intent>;
const lines: string[] = [];

function record(name: string, kind: TxKind, raw: Uint8Array, reviewed: It, nowS = NOW): boolean {
  const ok = validateTransaction(raw, kind, reviewed, nowS).ok;
  lines.push([
    name, kind, ok ? 'ok' : 'fail', reviewed.wallet, reviewed.blockhash, reviewed.amountIn, reviewed.minOut, reviewed.target,
    reviewed.lockId, reviewed.unlockAt, nowS, reviewed.cuPrice, 0, reviewed.wsolExists ? 1 : 0,
    Buffer.from(raw).toString('base64'),
  ].join('\t'));
  return ok;
}
const rawFrom = (ixs: TransactionInstruction[]): Uint8Array =>
  new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(WALLET), recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message([])).serialize();
const built = (kind: TxKind, it: It): Uint8Array => compile(kind, it).serialize();

describe('export validator vectors', () => {
  it('valid transactions', () => {
    for (const kind of ['single', 'swap', 'lock'] as TxKind[]) expect(record(`valid-${kind}`, kind, built(kind, intent()), intent())).toBe(true);
    const fee = intent({ cuPrice: 5_000 });
    expect(record('valid-single-fee', 'single', built('single', fee), fee)).toBe(true);
    expect(record('valid-swap-fee', 'swap', built('swap', fee), fee)).toBe(true);
    expect(record('valid-lock-fee', 'lock', built('lock', fee), fee)).toBe(true);
    const keep = intent({ wsolExists: true });
    expect(record('valid-single-wsol-exists', 'single', built('single', keep), keep)).toBe(true);
    expect(record('valid-swap-wsol-exists', 'swap', built('swap', keep), keep)).toBe(true);
    const other = intent({ lockId: 17n, minOut: 777_000_000_000n, target: 800_000_000_000n });
    expect(record('valid-single-lock17', 'single', built('single', other), other)).toBe(true);
  });

  it('tampered fields (bytes from one intent, reviewed another)', () => {
    const raw = built('single', intent());
    const patches: [string, Partial<It>][] = [
      ['amountIn', { amountIn: 10_232_000n }],
      ['minOut', { minOut: 205_000_000_001n, target: 209_000_000_000n }],
      ['lockId', { lockId: 4n }],
      ['unlockAt', { unlockAt: BigInt(NOW + PASS_SECONDS + 1) }],
      ['cuPrice', { cuPrice: 7 }],
      ['blockhash', { blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi' }],
      ['wallet', { wallet: Keypair.generate().publicKey.toBase58() }],
      ['wsolExists', { wsolExists: true }],
    ];
    for (const [n, p] of patches) expect(record(`tamper-${n}`, 'single', raw, intent(p))).toBe(false);
    expect(record('wrong-kind-swap-as-single', 'single', built('swap', intent()), intent())).toBe(false);
    expect(record('wrong-kind-lock-as-swap', 'swap', built('lock', intent()), intent())).toBe(false);
  });

  it('policy bounds', () => {
    const both = (n: string, p: Partial<It>, expectOk = false) => {
      const it2 = intent(p);
      expect(record(n, 'single', built('single', it2), it2)).toBe(expectOk);
    };
    both('amount-below-nominal', { amountIn: 9_999_000n });
    both('amount-above-nominal', { amountIn: 10_000_001n });
    both('amount-at-old-cap', { amountIn: 10_600_000n });
    both('minout-follows-market', { minOut: 900_000_000_000n, target: 1_000_000_000_000n }, true);
    both('minout-small-ok', { minOut: 1n, target: 1n }, true);
    both('fee-too-high', { cuPrice: 200_001 });
    both('fee-max', { cuPrice: 200_000 }, true);
    both('lock-id-65', { lockId: 65n });
    both('unlock-too-early', { unlockAt: BigInt(NOW + PASS_SECONDS - 1801) });
    both('unlock-too-late', { unlockAt: BigInt(NOW + PASS_SECONDS + 301) });
    both('unlock-earliest-ok', { unlockAt: BigInt(NOW + PASS_SECONDS - 1800) }, true);
  });

  it('structural attacks', () => {
    const it0 = intent();
    const base = () => instructionsFor('single', it0);
    const extra = new TransactionInstruction({ programId: new PublicKey('11111111111111111111111111111111'), keys: [], data: Buffer.from([]) });
    expect(record('attack-extra-ix', 'single', rawFrom([...base(), extra]), it0)).toBe(false);
    const re = base();
    [re[3], re[4]] = [re[4]!, re[3]!];
    expect(record('attack-reordered', 'single', rawFrom(re), it0)).toBe(false);
    const big = base();
    big[0] = setCuLimitIx(500_000);
    expect(record('attack-cu-limit-too-high', 'single', rawFrom(big), it0)).toBe(false);
    expect(record('attack-two-cu-limits', 'single', rawFrom([setCuLimitIx(300_000), ...base().slice(0, -1)]), it0)).toBe(false);
    expect(record('attack-price-smuggled', 'single', rawFrom([base()[0]!, setCuPriceIx(1), ...base().slice(1, -1)]), it0)).toBe(false);
    const swapped = base();
    const last = swapped[swapped.length - 1]!;
    swapped[swapped.length - 1] = new TransactionInstruction({
      programId: last.programId, data: last.data,
      keys: last.keys.map((k, i) => (i === 1 ? { ...k, pubkey: Keypair.generate().publicKey } : k)),
    });
    expect(record('attack-lock-other-mint', 'single', rawFrom(swapped), it0)).toBe(false);
    const writable = base();
    const lw = writable[writable.length - 1]!;
    writable[writable.length - 1] = new TransactionInstruction({
      programId: lw.programId, data: lw.data, keys: lw.keys.map((k, i) => (i === 1 ? { ...k, isWritable: true } : k)),
    });
    expect(record('attack-writable-flag', 'single', rawFrom(writable), it0)).toBe(false);
    // Swap destination replaced by an attacker account in the first token account slot.
    const redirect = base();
    const sw = redirect.find((ix) => ix.programId.toBase58() === DAMM_PROGRAM)!;
    const idx = redirect.indexOf(sw);
    redirect[idx] = new TransactionInstruction({
      programId: sw.programId, data: sw.data, keys: sw.keys.map((k, i) => (i === 3 ? { ...k, pubkey: Keypair.generate().publicKey } : k)),
    });
    expect(record('attack-swap-output-redirected', 'single', rawFrom(redirect), it0)).toBe(false);
    // Lamports transfer redirected.
    const steal = base();
    const ti = steal.findIndex((ix) => ix.programId.toBase58() === '11111111111111111111111111111111');
    const tr = steal[ti]!;
    steal[ti] = new TransactionInstruction({
      programId: tr.programId, data: tr.data, keys: tr.keys.map((k, i) => (i === 1 ? { ...k, pubkey: Keypair.generate().publicKey } : k)),
    });
    expect(record('attack-transfer-redirected', 'single', rawFrom(steal), it0)).toBe(false);
  });

  it('writes the file', () => {
    const dir = new URL('../../android-host/android/app/src/test/resources/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('validator-vectors.txt', dir), `# name\tkind\texpect\twallet\tblockhash\tamountIn\tminOut\ttarget\tlockId\tunlockAt\tnowS\tcuPrice\tbuyback\twsolExists\ttxBase64\n${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(30);
  });
});
