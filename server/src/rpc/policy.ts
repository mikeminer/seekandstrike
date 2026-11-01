/**
 * Daily Pass RPC proxy policy (pure, runtime-agnostic; ported from the DevFridge rpc-proxy template
 * policy, reduced to exactly what the game calls). Every request is checked BEFORE it reaches the
 * private upstream: method allowlist, strict parameter shapes, a fixed getProgramAccounts rule
 * (Fridge pass records of one wallet for the pass token (PASTA) only) and transaction relay limited to the
 * programs the Daily Pass uses.
 */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const FRIDGE_PROGRAM = '9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6';
/** Meteora DAMM v2 (cp-amm): the pool the pass token is bought in. */
export const DAMM_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
export const PASS_MINT = '39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump';
/** base58 of the Fridge lock-account discriminator 08ff24cad2163989. */
export const LOCK_DISC_B58 = '2WHAy3LEoEg';
export const LOCK_SIZE = 105;
/** Top-level programs a Daily Pass transaction may contain (purchase, activate, release). */
export const TX_PROGRAMS = new Set([
  'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  DAMM_PROGRAM,
  FRIDGE_PROGRAM,
]);
/** Every relayed transaction must touch the Fridge program (pass) or the Meteora pool (quote sims). */
export const TX_REQUIRED = new Set([FRIDGE_PROGRAM, DAMM_PROGRAM]);
export const MAX_TX_BYTES = 1232;
export const MAX_BATCH = 1;
export const MAX_BODY_BYTES = 8 * 1024;

export const METHODS = [
  'getBalance', 'getLatestBlockhash', 'getBlockHeight', 'getGenesisHash', 'getMinimumBalanceForRentExemption',
  'getMultipleAccounts', 'getAccountInfo', 'getProgramAccounts', 'getRecentPrioritizationFees',
  'getSignaturesForAddress', 'getTransaction', 'getSignatureStatuses', 'simulateTransaction', 'sendTransaction',
] as const;
export type Method = (typeof METHODS)[number];
/** Relative budget cost (a rate-limit token per unit). */
export const COST: Record<Method, number> = {
  getBalance: 1, getLatestBlockhash: 1, getBlockHeight: 1, getGenesisHash: 1, getMinimumBalanceForRentExemption: 1,
  getMultipleAccounts: 1, getAccountInfo: 1, getProgramAccounts: 3, getRecentPrioritizationFees: 1,
  getSignaturesForAddress: 2, getTransaction: 2, getSignatureStatuses: 1, simulateTransaction: 3, sendTransaction: 5,
};

export class PolicyError extends Error {
  constructor(readonly code = -32602, message = 'Request parameters are not permitted.') { super(message); }
}
const fail = (msg?: string): never => { throw new PolicyError(-32602, msg); };
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function onlyKeys(v: unknown, allowed: string[]): Record<string, unknown> {
  if (!isObj(v) || Object.keys(v).some((k) => !allowed.includes(k))) fail();
  return v as Record<string, unknown>;
}

export function b58decode(s: unknown, len: number): Uint8Array {
  if (typeof s !== 'string' || !s.length || s.length > Math.ceil(len * 1.38)) fail();
  let n = 0n;
  for (const c of s as string) { const i = B58.indexOf(c); if (i < 0) fail(); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s as string) { if (c !== '1') break; out.unshift(0); }
  if (out.length !== len) fail();
  return Uint8Array.from(out);
}
export function b58encode(b: Uint8Array): string {
  let n = 0n; for (const x of b) n = n * 256n + BigInt(x);
  let s = ''; while (n) { s = B58[Number(n % 58n)]! + s; n /= 58n; }
  for (const x of b) { if (x !== 0) break; s = '1' + s; }
  return s;
}
const addr = (v: unknown): string => { b58decode(v, 32); return v as string; };
const sig = (v: unknown): string => { b58decode(v, 64); return v as string; };
function b64(v: unknown, max: number): Uint8Array {
  if (typeof v !== 'string' || !v.length || v.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) fail();
  let bin: string;
  try { bin = atob(v as string); } catch { return fail(); }
  if (!bin.length || bin.length > max) fail();
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const COMMITMENTS = ['processed', 'confirmed', 'finalized'];
function commitment(cfg: Record<string, unknown>): void {
  if (cfg.commitment !== undefined && !COMMITMENTS.includes(cfg.commitment as string)) fail();
}
function config(v: unknown, allowed: string[]): Record<string, unknown> {
  if (v === undefined) return {};
  const c = onlyKeys(v, allowed);
  commitment(c);
  if (c.encoding !== undefined && c.encoding !== 'base64') fail();
  return c;
}
function params(p: unknown, min: number, max: number): unknown[] {
  if (p === undefined && min === 0) return [];
  if (!Array.isArray(p) || p.length < min || p.length > max) fail();
  return p as unknown[];
}
function int(v: unknown, lo: number, hi: number): number {
  if (!Number.isSafeInteger(v) || (v as number) < lo || (v as number) > hi) fail();
  return v as number;
}

/** Top-level program ids of a (legacy or v0) wire transaction; LUT entries cannot be programs. */
export function txPrograms(raw: Uint8Array): string[] {
  let o = 0;
  const u8 = (): number => { if (o >= raw.length) fail('truncated'); return raw[o++]!; };
  const cu16 = (): number => { let v = 0; for (let s = 0; s < 3; s++) { const b = u8(); v |= (b & 0x7f) << (7 * s); if (!(b & 0x80)) return v; } return fail('bad length'); };
  const skip = (n: number) => { if (o + n > raw.length) fail('truncated'); o += n; };
  const nsig = cu16(); if (nsig < 1 || nsig > 4) fail('signatures');
  skip(64 * nsig);
  if (raw[o]! & 0x80) { if ((u8() & 0x7f) > 1) fail('version'); }
  skip(3);
  const nkeys = cu16(); if (nkeys < 1 || nkeys > 64) fail('keys');
  const keys: string[] = [];
  for (let i = 0; i < nkeys; i++) { keys.push(b58encode(raw.subarray(o, o + 32))); skip(32); }
  skip(32);
  const nix = cu16(); if (nix < 1 || nix > 16) fail('instructions');
  const progs: string[] = [];
  for (let i = 0; i < nix; i++) {
    const p = u8();
    if (p >= keys.length) fail('program index');
    progs.push(keys[p]!);
    skip(cu16()); skip(cu16());
  }
  return progs;
}
function relayTx(v: unknown): void {
  const raw = b64(v, MAX_TX_BYTES);
  const progs = txPrograms(raw);
  if (progs.some((p) => !TX_PROGRAMS.has(p))) fail('program not allowed');
  if (!progs.some((p) => TX_REQUIRED.has(p))) fail('not a Daily Pass transaction');
}

/** Validate one JSON-RPC call. Throws PolicyError; returns the method on success. */
export function validateCall(call: unknown): { method: Method; id: string | number | null } {
  if (!isObj(call) || call.jsonrpc !== '2.0') throw new PolicyError(-32600, 'Invalid request.');
  const id = call.id;
  if (!(typeof id === 'number' || typeof id === 'string' || id === null)) throw new PolicyError(-32600, 'Invalid request.');
  onlyKeys(call, ['jsonrpc', 'id', 'method', 'params']);
  const method = call.method as Method;
  if (!(METHODS as readonly string[]).includes(method)) throw new PolicyError(-32601, 'Method not allowed.');
  const p = call.params;
  switch (method) {
    case 'getBalance': { const a = params(p, 1, 2); addr(a[0]); config(a[1], ['commitment', 'minContextSlot']); break; }
    case 'getLatestBlockhash': case 'getBlockHeight': { const a = params(p, 0, 1); config(a[0], ['commitment', 'minContextSlot']); break; }
    case 'getGenesisHash': params(p, 0, 0); break;
    case 'getMinimumBalanceForRentExemption': { const a = params(p, 1, 2); int(a[0], 0, 10_240); config(a[1], ['commitment']); break; }
    case 'getAccountInfo': { const a = params(p, 1, 2); addr(a[0]); config(a[1], ['commitment', 'encoding', 'minContextSlot']); break; }
    case 'getMultipleAccounts': {
      const a = params(p, 1, 2);
      if (!Array.isArray(a[0]) || !a[0].length || a[0].length > 100) fail();
      (a[0] as unknown[]).forEach(addr);
      config(a[1], ['commitment', 'encoding', 'minContextSlot']);
      break;
    }
    case 'getProgramAccounts': {
      // Fixed rule: Fridge pass records (105 bytes, lock discriminator) of ONE wallet for the pass token (PASTA).
      const a = params(p, 2, 2);
      if (a[0] !== FRIDGE_PROGRAM) fail();
      const c = config(a[1], ['commitment', 'encoding', 'filters', 'withContext']);
      if (c.encoding !== 'base64') fail();
      const f = c.filters;
      if (!Array.isArray(f) || f.length !== 4) fail();
      const [size, disc, dep, mint] = f as unknown[];
      if (onlyKeys(size, ['dataSize']).dataSize !== LOCK_SIZE) fail();
      const mc = (x: unknown, off: number): string => {
        const m = onlyKeys(onlyKeys(x, ['memcmp']).memcmp, ['offset', 'bytes']);
        if (m.offset !== off || typeof m.bytes !== 'string') fail();
        return m.bytes as string;
      };
      if (mc(disc, 0) !== LOCK_DISC_B58) fail();
      addr(mc(dep, 8));
      if (mc(mint, 40) !== PASS_MINT) fail();
      break;
    }
    case 'getRecentPrioritizationFees': {
      const a = params(p, 0, 1);
      if (a[0] !== undefined) { if (!Array.isArray(a[0]) || a[0].length > 128) fail(); (a[0] as unknown[]).forEach(addr); }
      break;
    }
    case 'getSignaturesForAddress': {
      const a = params(p, 1, 2); addr(a[0]);
      const c = config(a[1], ['commitment', 'limit', 'before', 'until', 'minContextSlot']);
      if (c.limit !== undefined) int(c.limit, 1, 100);
      if (c.before !== undefined) sig(c.before);
      if (c.until !== undefined) sig(c.until);
      break;
    }
    case 'getTransaction': {
      const a = params(p, 1, 2); sig(a[0]);
      const c = config(a[1], ['commitment', 'encoding', 'maxSupportedTransactionVersion']);
      if (c.commitment === 'processed') fail();
      if (c.maxSupportedTransactionVersion !== undefined) int(c.maxSupportedTransactionVersion, 0, 1);
      break;
    }
    case 'getSignatureStatuses': {
      const a = params(p, 1, 2);
      if (!Array.isArray(a[0]) || !a[0].length || a[0].length > 16) fail();
      (a[0] as unknown[]).forEach(sig);
      if (a[1] !== undefined) onlyKeys(a[1], ['searchTransactionHistory']);
      break;
    }
    case 'simulateTransaction': {
      const a = params(p, 2, 2);
      relayTx(a[0]);
      const c = config(a[1], ['encoding', 'commitment', 'sigVerify', 'replaceRecentBlockhash', 'accounts', 'innerInstructions', 'minContextSlot']);
      if (c.encoding !== 'base64' || c.sigVerify === true) fail();
      if (c.accounts !== undefined) {
        const ac = onlyKeys(c.accounts, ['encoding', 'addresses']);
        if (ac.encoding !== 'base64' || !Array.isArray(ac.addresses) || ac.addresses.length > 20) fail();
        (ac.addresses as unknown[]).forEach(addr);
      }
      break;
    }
    case 'sendTransaction': {
      const a = params(p, 2, 2);
      relayTx(a[0]);
      const c = config(a[1], ['encoding', 'skipPreflight', 'preflightCommitment', 'maxRetries', 'minContextSlot']);
      if (c.encoding !== 'base64' || c.skipPreflight === true) fail();
      if (c.maxRetries !== undefined) int(c.maxRetries, 0, 5);
      if (c.preflightCommitment !== undefined && !COMMITMENTS.includes(c.preflightCommitment as string)) fail();
      break;
    }
  }
  return { method, id: id as string | number | null };
}

/** Exact allowed browser origins (comma list, https only; http only for localhost). */
export function parseOrigins(list: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const o of (list ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const u = new URL(o);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.origin !== o || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) throw new Error('bad origin');
    out.add(o);
  }
  return out;
}
