import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';
import { FRIDGE_PROGRAM, LOCK_DISC_B58, PASS_MINT, txPrograms, validateCall } from './policy';
import { handleRpc } from './handler';

const W = Keypair.generate().publicKey.toBase58();
const call = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) });
const gpa = (over: Partial<Record<'prog' | 'mint' | 'size', unknown>> = {}) => call('getProgramAccounts', [over.prog ?? FRIDGE_PROGRAM, {
  encoding: 'base64', commitment: 'confirmed',
  filters: [{ dataSize: over.size ?? 105 }, { memcmp: { offset: 0, bytes: LOCK_DISC_B58 } }, { memcmp: { offset: 8, bytes: W } }, { memcmp: { offset: 40, bytes: over.mint ?? PASS_MINT } }],
}]);
const tx = (ixs: TransactionInstruction[]) => Buffer.from(new VersionedTransaction(new TransactionMessage({
  payerKey: new PublicKey(W), recentBlockhash: '11111111111111111111111111111111', instructions: ixs,
}).compileToV0Message()).serialize()).toString('base64');
const fridgeIx = new TransactionInstruction({ programId: new PublicKey(FRIDGE_PROGRAM), keys: [{ pubkey: new PublicKey(W), isSigner: true, isWritable: true }], data: Buffer.alloc(32) });
const transfer = SystemProgram.transfer({ fromPubkey: new PublicKey(W), toPubkey: Keypair.generate().publicKey, lamports: 1 });

describe('rpc proxy policy', () => {
  it('allows the calls the game makes', () => {
    expect(() => validateCall(call('getLatestBlockhash', [{ commitment: 'confirmed' }]))).not.toThrow();
    expect(() => validateCall(call('getMultipleAccounts', [[W, PASS_MINT], { encoding: 'base64', commitment: 'confirmed' }]))).not.toThrow();
    expect(() => validateCall(gpa())).not.toThrow();
    expect(() => validateCall(call('getMinimumBalanceForRentExemption', [105]))).not.toThrow();
    expect(() => validateCall(call('simulateTransaction', [tx([ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), fridgeIx]), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }]))).not.toThrow();
  });
  it('refuses methods outside the allowlist', () => {
    expect(() => validateCall(call('requestAirdrop', [W, 1]))).toThrow(/Method not allowed/);
    expect(() => validateCall(call('getTokenLargestAccounts', [PASS_MINT]))).toThrow();
  });
  it('getProgramAccounts only for Fridge pass records of SWANGY', () => {
    expect(() => validateCall(gpa({ prog: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }))).toThrow();
    expect(() => validateCall(gpa({ mint: W }))).toThrow();
    expect(() => validateCall(gpa({ size: 165 }))).toThrow();
  });
  it('relays only Daily Pass transactions', () => {
    expect(() => validateCall(call('sendTransaction', [tx([transfer]), { encoding: 'base64' }]))).toThrow();
    expect(() => validateCall(call('sendTransaction', [tx([fridgeIx, transfer]), { encoding: 'base64' }]))).not.toThrow();
    expect(() => validateCall(call('sendTransaction', [tx([fridgeIx]), { encoding: 'base64', skipPreflight: true }]))).toThrow();
    expect(() => validateCall(call('simulateTransaction', [tx([fridgeIx]), { encoding: 'base64', sigVerify: true }]))).toThrow();
    expect(txPrograms(Buffer.from(tx([fridgeIx]), 'base64'))).toEqual([FRIDGE_PROGRAM]);
  });
  it('rejects unknown keys and malformed addresses', () => {
    expect(() => validateCall({ ...call('getBalance', [W]), extra: 1 })).toThrow();
    expect(() => validateCall(call('getBalance', ['0OIl']))).toThrow();
  });
});

describe('rpc proxy handler', () => {
  const env = { RPC_UPSTREAM_URL: 'https://upstream.invalid/x', RPC_ALLOWED_ORIGINS: 'https://localhost' };
  const req = (body: unknown, origin: string | null = 'https://localhost') => new Request('https://proxy.invalid/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  it('forwards an allowed call and never exposes the upstream URL', async () => {
    let seen = '';
    const r = await handleRpc(req(call('getBlockHeight')), env, (async (u: string) => { seen = u; return new Response('{"jsonrpc":"2.0","id":1,"result":5}'); }) as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(seen).toBe(env.RPC_UPSTREAM_URL);
    expect(await r.text()).not.toContain('upstream.invalid');
    expect(r.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });
  it('blocks foreign origins, batches, disallowed methods and rate-limited clients', async () => {
    const never = (async () => { throw new Error('must not forward'); }) as unknown as typeof fetch;
    expect((await handleRpc(req(call('getBlockHeight'), 'https://evil.example'), env, never)).status).toBe(403);
    expect((await handleRpc(req(call('getBlockHeight'), null), env, never)).status).toBe(403);
    expect((await handleRpc(req([call('getBlockHeight')]), env, never)).status).toBe(400);
    expect((await handleRpc(req(call('requestAirdrop', [W, 1])), env, never)).status).toBe(400);
    const limited = { ...env, RPC_LIMIT: { limit: async () => ({ success: false }) } };
    expect((await handleRpc(req(call('getBlockHeight')), limited, never)).status).toBe(429);
  });
  it('without the upstream secret it answers 503', async () => {
    expect((await handleRpc(req(call('getBlockHeight')), { RPC_ALLOWED_ORIGINS: 'https://localhost' })).status).toBe(503);
  });
});
