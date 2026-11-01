// Local smoke test of the online access proof against a real `wrangler dev` (workerd), with a FAKE read-only Solana node.
// It starts both itself, on localhost only: the fake node serves Fridge lock accounts for generated test wallets, the Worker
// runs in its default (closed) mode and has to verify wallet signatures and read the "chain" before it seats anyone.
// Nothing here touches a real network, a real wallet or a deployed Worker, and no transaction is ever built or signed.
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const PORT = Number(process.env.SMOKE_PORT ?? 8791);
const BASE = `ws://127.0.0.1:${PORT}`;
const fail = (msg) => { console.error('FAIL:', msg); cleanup(); process.exit(1); };
const ok = (msg) => console.log('ok  ', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- test wallets and fake chain ----------
const FRIDGE = new PublicKey('9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6');
const MINT = new PublicKey('39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const FLOOR_RAW = 100_000_000_000n;
const LOCK_DISC = Buffer.from('08ff24cad2163989', 'hex');

const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };

function newWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const pk = new PublicKey(raw);
  return { pk, address: pk.toBase58(), sign: (text) => edSign(null, Buffer.from(text), privateKey).toString('base64') };
}

const accounts = new Map(); // address -> account info (base64)
const infoOf = (owner, data) => ({ owner: owner.toBase58(), lamports: 1_000_000, data: [data.toString('base64'), 'base64'], executable: false, space: data.length });

/** A one-day lock for `w` that ends `endsInS` seconds from now. */
function addLock(w, endsInS) {
  const now = Math.floor(Date.now() / 1000);
  const unlockAt = now + endsInS, createdAt = unlockAt - 86_400;
  const [lock, bump] = PublicKey.findProgramAddressSync([Buffer.from('lock'), w.pk.toBytes(), MINT.toBytes(), u64(1)], FRIDGE);
  const data = Buffer.concat([LOCK_DISC, w.pk.toBytes(), MINT.toBytes(), u64(FLOOR_RAW), i64(createdAt), i64(unlockAt), Buffer.from([bump]), u64(1)]);
  accounts.set(lock.toBase58(), infoOf(FRIDGE, data));
  const vault = Buffer.alloc(165);
  MINT.toBytes().forEach((b, i) => { vault[i] = b; });
  lock.toBytes().forEach((b, i) => { vault[32 + i] = b; });
  u64(FLOOR_RAW).copy(vault, 64);
  vault[108] = 1;
  const [vaultAta] = PublicKey.findProgramAddressSync([lock.toBytes(), TOKEN_2022.toBytes(), MINT.toBytes()], ATA_PROGRAM);
  accounts.set(vaultAta.toBase58(), infoOf(TOKEN_2022, vault));
  return unlockAt;
}

let nodeDown = false;
let rpcCalls = 0;
const rpc = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    rpcCalls++;
    if (nodeDown) { res.writeHead(500); res.end('down'); return; }
    const { id, method, params } = JSON.parse(body);
    let result;
    if (method === 'getProgramAccounts') {
      const wallet = params[1].filters.find((f) => f.memcmp?.offset === 8)?.memcmp.bytes;
      const mine = [...accounts].filter(([, a]) => a.owner === FRIDGE.toBase58() && new PublicKey(Buffer.from(a.data[0], 'base64').subarray(8, 40)).toBase58() === wallet);
      result = mine.map(([pubkey, account]) => ({ pubkey, account }));
    } else if (method === 'getMultipleAccounts') {
      result = { context: { slot: 1 }, value: params[0].map((k) => accounts.get(k) ?? null) };
    } else if (method === 'getSignaturesForAddress') result = [];
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } })); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
});
await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
const RPC_URL = `http://127.0.0.1:${rpc.address().port}`;

// ---------- start the Worker ----------
const isWin = process.platform === 'win32';
const wrangler = spawn(`npx wrangler dev -c server/wrangler.toml --port ${PORT} --ip 127.0.0.1 --var RPC_UPSTREAM_URL:${RPC_URL}`, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
let wranglerLog = '';
wrangler.stdout.on('data', (d) => { wranglerLog += d; });
wrangler.stderr.on('data', (d) => { wranglerLog += d; });
function cleanup() {
  try { if (isWin) execSync(`taskkill /pid ${wrangler.pid} /T /F`, { stdio: 'ignore' }); else wrangler.kill('SIGTERM'); } catch { /* already gone */ }
  rpc.close();
}
for (let i = 0; ; i++) {
  if (i > 120) fail(`wrangler did not start:\n${wranglerLog.slice(-1500)}`);
  try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) break; } catch { /* not up yet */ }
  await sleep(500);
}
ok('worker up in default (closed) mode, fake node at ' + RPC_URL);

// ---------- client helper ----------
function open(roomName, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/room/${roomName}/ws`);
    const c = { ws, msgs: [], waiters: [], closed: false, closeCode: 0, closeReason: '' };
    const push = (m) => { c.msgs.push(m); c.waiters.forEach((w) => w()); };
    ws.onopen = () => { if (hello) ws.send(JSON.stringify({ t: 'hello', v: 2, name: 'Smoke', cls: 0, ...hello })); resolve(c); };
    ws.onmessage = (e) => { const s = typeof e.data === 'string' ? e.data : ''; if (s !== 'pong') push(JSON.parse(s)); };
    ws.onclose = (e) => { c.closed = true; c.closeCode = e.code; c.closeReason = e.reason; c.waiters.forEach((w) => w()); };
    ws.onerror = () => { c.closed = true; c.waiters.forEach((w) => w()); };
    c.send = (m) => ws.send(JSON.stringify(m));
    /** Resolves with the first not-yet-consumed message of type `t` (or null on timeout/close). */
    c.next = (t, ms = 8000) => new Promise((res) => {
      const look = () => { const i = c.msgs.findIndex((m) => m.t === t); return i >= 0 ? c.msgs.splice(i, 1)[0] : null; };
      const hit = look();
      if (hit) return res(hit);
      const timer = setTimeout(() => { c.waiters = c.waiters.filter((w) => w !== check); res(null); }, ms);
      const check = () => { const m = look(); if (m || c.closed) { clearTimeout(timer); c.waiters = c.waiters.filter((w) => w !== check); res(m); } };
      c.waiters.push(check);
    });
    c.waitClosed = async (ms = 8000) => { const t0 = Date.now(); while (!c.closed && Date.now() - t0 < ms) await sleep(50); return c.closed; };
  });
}
const room = (n) => `${n}-${Date.now().toString(36)}`;

// ---------- scenarios ----------
const holder = newWallet(), nopass = newWallet(), thief = newWallet(), shortlived = newWallet(), outage = newWallet(), flooder = newWallet();
addLock(holder, 86_000);
const shortEnds = addLock(shortlived, 9);
addLock(outage, 86_000);
const R = room('proof');

// a. No wallet in hello: closed.
{
  const c = await open(R, {});
  const e = await c.next('error');
  if (e?.code !== 'pass_required') fail(`no wallet: expected pass_required, got ${JSON.stringify(e)}`);
  await c.waitClosed();
  ok('hello without a wallet is refused (pass_required)');
}

// b. Holder proves the wallet and gets a seat; snapshots flow.
let seat, token;
{
  const c = await open(R, { wallet: holder.address });
  const ch = await c.next('challenge');
  if (!ch) fail('no challenge received');
  if (!ch.message.includes(holder.address) || !ch.message.includes('not a transaction')) fail('challenge text is not the expected template');
  c.send({ t: 'input', seq: 0, cmds: [{ moveX: 0, moveY: 1, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0 }] });
  const early = await c.next('error', 2000);
  if (early?.code !== 'not_joined') fail(`input before auth should be not_joined, got ${JSON.stringify(early)}`);
  c.send({ t: 'auth', sig: holder.sign(ch.message) });
  const w = await c.next('welcome');
  if (!w) fail('holder with a valid pass and signature was not seated');
  seat = w.playerId; token = w.resumeToken;
  const s = await c.next('snap');
  if (!s) fail('no snapshot after welcome');
  ok(`holder proved the wallet, seated as ${seat}, snapshots flowing`);
  // auth is single use
  c.send({ t: 'auth', sig: holder.sign(ch.message) });
  const again = await c.next('error', 3000);
  if (again?.code !== 'bad_message') fail(`second auth should be bad_message, got ${JSON.stringify(again)}`);
  ok('a challenge answers only once');
  c.holderSocket = true;
  globalThis.holderSocket = c;
}

// c. Wrong key signs the holder's challenge.
{
  const c = await open(room('bad'), { wallet: holder.address });
  const ch = await c.next('challenge');
  c.send({ t: 'auth', sig: thief.sign(ch.message) });
  const e = await c.next('error');
  if (e?.code !== 'proof_invalid') fail(`stolen-address signature: expected proof_invalid, got ${JSON.stringify(e)}`);
  ok("someone else's key cannot claim the holder's pass (proof_invalid)");
}

// d. Valid signature, wallet without a pass.
{
  const c = await open(room('nopass'), { wallet: nopass.address });
  const ch = await c.next('challenge');
  c.send({ t: 'auth', sig: nopass.sign(ch.message) });
  const e = await c.next('error');
  if (e?.code !== 'pass_required') fail(`wallet without pass: expected pass_required, got ${JSON.stringify(e)}`);
  ok('a wallet without a Daily Pass is refused (pass_required)');
}

// e. Replay: a signature made for socket A's challenge is useless on socket B.
{
  const rr = room('replay');
  const a = await open(rr, { wallet: holder.address });
  const b = await open(rr, { wallet: holder.address });
  const chA = await a.next('challenge'), chB = await b.next('challenge');
  if (chA.message === chB.message) fail('two sockets got the same challenge');
  b.send({ t: 'auth', sig: holder.sign(chA.message) });
  const e = await b.next('error');
  if (e?.code !== 'proof_invalid') fail(`replayed signature: expected proof_invalid, got ${JSON.stringify(e)}`);
  a.ws.close();
  ok('a signature for another challenge is rejected (no replay)');
}

// f. The node is down: "unavailable", not "no pass".
{
  nodeDown = true;
  const c = await open(room('down'), { wallet: outage.address });
  const ch = await c.next('challenge');
  c.send({ t: 'auth', sig: outage.sign(ch.message) });
  const e = await c.next('error', 20000);
  nodeDown = false;
  if (e?.code !== 'pass_unavailable') fail(`node down: expected pass_unavailable, got ${JSON.stringify(e)}`);
  ok('an unreachable node reads as pass_unavailable');
  const again = await open(room('up'), { wallet: outage.address });
  const ch2 = await again.next('challenge');
  again.send({ t: 'auth', sig: outage.sign(ch2.message) });
  if (!(await again.next('welcome'))) fail('after the node came back the holder should be seated');
  again.ws.close();
  ok('and works again once the node is back (the outage was not cached)');
}

// g. Same wallet on a second device takes over the seat.
{
  const first = globalThis.holderSocket;
  const c = await open(R, { wallet: holder.address });
  const ch = await c.next('challenge');
  c.send({ t: 'auth', sig: holder.sign(ch.message) });
  const w = await c.next('welcome');
  if (!w) fail('second connection of the same wallet was not seated');
  if (w.playerId !== seat) fail(`takeover should keep seat ${seat}, got ${w.playerId}`);
  if (!(await first.waitClosed(5000))) fail('the first socket of the wallet was not closed on takeover');
  token = w.resumeToken;
  globalThis.holderSocket = c;
  ok('the same wallet on a new connection takes over its seat; the old socket is closed');
}

// h. Reconnect without signing again.
{
  globalThis.holderSocket.ws.close();
  await sleep(500);
  const c = await open(R, { resumeToken: token });
  const w = await c.next('welcome', 5000);
  if (!w || w.playerId !== seat) fail(`resume with token: expected seat ${seat}, got ${JSON.stringify(w)}`);
  if (await c.next('challenge', 300)) fail('resume should not ask for a new signature');
  c.ws.close();
  ok('a dropped player resumes the seat with the token, no new signature');
}

// i. A token alone never opens a fresh seat.
{
  const c = await open(room('token'), { resumeToken: 'f'.repeat(32) });
  const e = await c.next('error');
  if (e?.code !== 'pass_required') fail(`unknown token without wallet: expected pass_required, got ${JSON.stringify(e)}`);
  ok('an unknown resume token does not bypass the proof');
}

// j. The pass ends while playing: the seat is closed with pass_expired.
{
  const rr = room('expire');
  const c = await open(rr, { wallet: shortlived.address });
  const ch = await c.next('challenge');
  c.send({ t: 'auth', sig: shortlived.sign(ch.message) });
  const w = await c.next('welcome');
  if (!w) fail('short-lived pass should be accepted while valid');
  const wait = Math.max(0, shortEnds * 1000 - Date.now()) + 1500;
  const e = await c.next('error', wait + 5000);
  if (e?.code !== 'pass_expired') fail(`expiry: expected pass_expired, got ${JSON.stringify(e)}`);
  if (!(await c.waitClosed(3000))) fail('expired seat was not closed');
  ok('when the pass ends the seat is closed (pass_expired)');
}

// k. Chain reads are limited per IP: a burst of proof attempts hits rate_limited.
{
  const before = rpcCalls;
  let limited = 0;
  for (let i = 0; i < 20; i++) {
    const c = await open(room('flood'), { wallet: flooder.address });
    const r = await Promise.race([c.next('challenge', 3000), c.next('error', 3000)]);
    if (r?.code === 'rate_limited') limited++;
    c.ws.close();
  }
  if (limited < 1) fail('no rate_limited after 20 proof attempts from one address');
  ok(`proof attempts are limited per IP (${limited} of 20 refused); chain reads made by the flood: ${rpcCalls - before}`);
}

console.log('\npass-smoke OK');
globalThis.holderSocket?.ws.close();
cleanup();
process.exit(0);
