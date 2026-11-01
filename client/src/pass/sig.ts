/** base58 (Bitcoin alphabet) encoder for 64-byte signatures. */
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = ALPHA[Number(n % 58n)]! + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
export function sigToB58(sig: Uint8Array): string {
  if (sig.length !== 64) throw new Error('bad signature length');
  return base58(sig);
}
