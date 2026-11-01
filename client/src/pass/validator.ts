import './polyfill';
import { PublicKey } from '@solana/web3.js';
import { eqBytes, hexBytes, readI64, readU64 } from './bytes';
import {
  COMPUTE_BUDGET_PROGRAM, DISC, MAX_COMPUTE_UNITS, MAX_PRIORITY_MICROLAMPORTS, NOMINAL_LAMPORTS,
  PASS_SECONDS, TX_SIZE_LIMIT,
} from './constants';
import { instructionsFor, type PurchaseIntent, type TxKind } from './txbuilder';

/**
 * Pre-wallet transaction validator (the TS twin of the skill's "native validator"; the Kotlin port
 * is required when the Android host is built — docs/daily-pass-test-plan.md §7).
 *
 * It decodes the exact unsigned bytes handed to the wallet with its own bounded parser (it does not
 * trust web3.js) and compares them, instruction by instruction, with what the player reviewed.
 */
export interface DecodedIx { programId: string; accounts: { key: string; signer: boolean; writable: boolean }[]; data: Uint8Array }
export interface DecodedTx {
  numSignatures: number; signaturesZero: boolean; version: 0; header: [number, number, number];
  keys: string[]; blockhash: string; ixs: DecodedIx[]; lookups: number;
}

class Reader {
  o = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number { if (this.o >= this.b.length) throw new Error('eof'); return this.b[this.o++]!; }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.o + n > this.b.length) throw new Error('eof');
    const s = this.b.subarray(this.o, this.o + n); this.o += n; return s;
  }
  cu16(): number {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const x = this.u8();
      v |= (x & 0x7f) << (7 * i);
      if (!(x & 0x80)) {
        if (i > 0 && x === 0) throw new Error('non-canonical compact-u16');
        return v;
      }
    }
    throw new Error('compact-u16 overflow');
  }
}

export function decodeTransaction(raw: Uint8Array): DecodedTx {
  if (raw.length > TX_SIZE_LIMIT) throw new Error('too large');
  const r = new Reader(raw);
  const nsig = r.cu16();
  if (nsig > 4) throw new Error('too many signatures');
  let zero = true;
  for (let i = 0; i < nsig; i++) if (r.bytes(64).some((x) => x !== 0)) zero = false;
  const prefix = r.u8();
  if (prefix !== 0x80) throw new Error('not a v0 message');
  const header: [number, number, number] = [r.u8(), r.u8(), r.u8()];
  const nkeys = r.cu16();
  if (nkeys > 64) throw new Error('too many keys');
  const keys: string[] = [];
  for (let i = 0; i < nkeys; i++) keys.push(new PublicKey(Uint8Array.from(r.bytes(32))).toBase58());
  const blockhash = new PublicKey(Uint8Array.from(r.bytes(32))).toBase58();
  const nix = r.cu16();
  if (nix > 16) throw new Error('too many instructions');
  const signerAt = (i: number) => i < header[0];
  const writableAt = (i: number) =>
    i < header[0] ? i < header[0] - header[1] : i < nkeys - header[2];
  const ixs: DecodedIx[] = [];
  for (let k = 0; k < nix; k++) {
    const p = r.u8();
    if (p >= nkeys) throw new Error('program index');
    const na = r.cu16();
    if (na > 48) throw new Error('too many accounts');
    const accounts = [];
    for (let j = 0; j < na; j++) {
      const a = r.u8();
      if (a >= nkeys) throw new Error('account index');
      accounts.push({ key: keys[a]!, signer: signerAt(a), writable: writableAt(a) });
    }
    const dl = r.cu16();
    if (dl > 1024) throw new Error('data too long');
    ixs.push({ programId: keys[p]!, accounts, data: Uint8Array.from(r.bytes(dl)) });
  }
  const lookups = r.cu16();
  if (r.o !== raw.length) throw new Error('trailing bytes');
  return { numSignatures: nsig, signaturesZero: zero, version: 0, header, keys, blockhash, ixs, lookups };
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate `raw` (one serialized unsigned VersionedTransaction) of kind `kind` against `intent`.
 * `nowS` is the signing-time clock used to bound unlock_at.
 */
export function validateTransaction(raw: Uint8Array, kind: TxKind, intent: PurchaseIntent, nowS: number): ValidationResult {
  let d: DecodedTx;
  try { d = decodeTransaction(raw); } catch (e) { return { ok: false, reason: `decode: ${(e as Error).message}` }; }
  const fail = (reason: string): ValidationResult => ({ ok: false, reason });
  if (d.numSignatures !== 1 || d.header[0] !== 1) return fail('exactly one signer');
  if (!d.signaturesZero) return fail('already signed');
  if (d.header[1] !== 0) return fail('fee payer must be writable');
  if (d.lookups !== 0) return fail('lookup tables are not allowed');
  if (d.keys[0] !== intent.wallet) return fail('signer is not the connected wallet');
  if (d.blockhash !== intent.blockhash) return fail('unexpected blockhash');
  if (new Set(d.keys).size !== d.keys.length) return fail('duplicate keys');

  // Amount policy, independent of the rebuild below.
  if (kind !== 'lock') {
    if (intent.amountIn !== NOMINAL_LAMPORTS) return fail('the purchase must be exactly the nominal amount');
  }
  if (intent.minOut <= 0n) return fail('no guaranteed amount');
  if (intent.cuPrice < 0 || intent.cuPrice > MAX_PRIORITY_MICROLAMPORTS) return fail('priority fee too high');
  if (intent.lockId < 1n || intent.lockId > 64n) return fail('bad lock id');

  const expected = instructionsFor(kind, intent);
  if (d.ixs.length !== expected.length) return fail('unexpected instruction count');

  // Expected message-level flags: union over the expected instructions (+ fee payer).
  const want = new Map<string, { signer: boolean; writable: boolean }>();
  want.set(intent.wallet, { signer: true, writable: true });
  for (const ix of expected) {
    const pid = ix.programId.toBase58();
    if (!want.has(pid)) want.set(pid, { signer: false, writable: false });
    for (const k of ix.keys) {
      const cur = want.get(k.pubkey.toBase58()) ?? { signer: false, writable: false };
      want.set(k.pubkey.toBase58(), { signer: cur.signer || k.isSigner, writable: cur.writable || k.isWritable });
    }
  }
  if (want.size !== d.keys.length) return fail('unexpected accounts in message');
  for (let i = 0; i < d.keys.length; i++) {
    const w = want.get(d.keys[i]!);
    if (!w) return fail('unknown account in message');
    const signer = i < d.header[0];
    const writable = i < d.header[0] ? i < d.header[0] - d.header[1] : i < d.keys.length - d.header[2];
    if (w.signer !== signer || w.writable !== writable) return fail('account permission mismatch');
  }

  let cuLimits = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const g = d.ixs[i]!;
    const pid = e.programId.toBase58();
    if (g.programId !== pid) return fail(`instruction ${i}: program mismatch`);
    if (g.accounts.length !== e.keys.length) return fail(`instruction ${i}: account count`);
    for (let j = 0; j < e.keys.length; j++) {
      if (g.accounts[j]!.key !== e.keys[j]!.pubkey.toBase58()) return fail(`instruction ${i}: account ${j} mismatch`);
    }
    const ed = Uint8Array.from(e.data);
    if (pid === COMPUTE_BUDGET_PROGRAM) {
      if (g.data[0] === 2) {
        cuLimits++;
        if (g.data.length !== 5) return fail('bad compute limit');
        const units = new DataView(g.data.buffer, g.data.byteOffset).getUint32(1, true);
        if (units > MAX_COMPUTE_UNITS) return fail('compute limit too high');
      } else if (g.data[0] === 3) {
        if (g.data.length !== 9) return fail('bad priority fee');
        if (readU64(g.data, 1) > BigInt(MAX_PRIORITY_MICROLAMPORTS)) return fail('priority fee too high');
      } else return fail('unexpected compute budget instruction');
      if (!eqBytes(g.data, ed)) return fail(`instruction ${i}: data mismatch`);
      continue;
    }
    if (eqBytes(ed.subarray(0, 8), hexBytes(DISC.createLock))) {
      if (g.data.length !== 32 || !eqBytes(g.data.subarray(0, 8), ed.subarray(0, 8))) return fail('pass instruction layout');
      if (readU64(g.data, 8) !== intent.minOut) return fail('pass amount differs from the guaranteed amount');
      const unlock = readI64(g.data, 16);
      const lo = BigInt(nowS + PASS_SECONDS - 1800);
      const hi = BigInt(nowS + PASS_SECONDS + 300);
      if (unlock < lo || unlock > hi) return fail('pass end time outside the allowed window');
      if (readU64(g.data, 24) !== intent.lockId) return fail('lock id mismatch');
      if (unlock !== intent.unlockAt) return fail('pass end time differs from the reviewed one');
      continue;
    }
    if (eqBytes(ed.subarray(0, 8), hexBytes(DISC.dammSwap))) {
      if (g.data.length !== 24) return fail('swap layout');
      if (readU64(g.data, 8) !== intent.amountIn) return fail('swap input differs from the review');
      if (readU64(g.data, 16) !== intent.minOut) return fail('swap minimum differs from the review');
    }
    if (!eqBytes(g.data, ed)) return fail(`instruction ${i}: data mismatch`);
  }
  if (cuLimits !== 1) return fail('exactly one compute limit');
  return { ok: true };
}
