import { Buffer } from 'buffer';
/** Small exact-integer byte helpers (no floating point anywhere near amounts). */
export const U64_MAX = (1n << 64n) - 1n;
export const I64_MAX = (1n << 63n) - 1n;

export function hexBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
export function u64le(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new Error('u64 out of range');
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
export function i64le(v: bigint): Uint8Array {
  if (v < -(1n << 63n) || v > I64_MAX) throw new Error('i64 out of range');
  return u64le(v < 0n ? (1n << 64n) + v : v);
}
export function readU64(b: Uint8Array, off: number): bigint {
  if (off < 0 || off + 8 > b.length) throw new Error('read past end');
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i]!);
  return v;
}
export function readI64(b: Uint8Array, off: number): bigint {
  const v = readU64(b, off);
  return v >= 1n << 63n ? v - (1n << 64n) : v;
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'base64'));
}
export function bytesToB64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}
/** Exact decimal formatting of raw integer units. */
export function formatUnits(raw: bigint, decimals: number, maxFrac = decimals): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  if (maxFrac === 0) frac = '';
  return `${neg ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}
