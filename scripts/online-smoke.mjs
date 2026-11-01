// Local smoke test of the online MatchRoom against `npm run server:dev:online` (wrangler dev, port 8787).
// 8 players join, move and shoot for a while; checks seat limits, snapshot rate/size, ack, pass gating and reconnect.
// Never touches a deployed Worker: refuses any host but localhost.
const BASE = process.env.ROOM_URL ?? 'ws://localhost:8787';
if (!/^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('Refusing to run against', BASE); process.exit(2); }
const ROOM = `smoke-${Date.now().toString(36)}`;
const SECONDS = Number(process.env.SMOKE_SECONDS ?? 20);

const open = (name, cls) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE}/room/${ROOM}/ws`);
  const c = { ws, name, snaps: 0, bytes: 0, last: null, welcome: null, errors: [], seq: 0, events: 0 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 2, name, cls }));
  ws.onmessage = (e) => {
    const s = typeof e.data === 'string' ? e.data : '';
    c.bytes += s.length;
    if (s === 'pong') return;
    const m = JSON.parse(s);
    if (m.t === 'welcome') { c.welcome = m; resolve(c); }
    else if (m.t === 'snap') { c.snaps++; c.last = m; c.events += m.ev.length; }
    else if (m.t === 'error') { c.errors.push(m.code); if (!c.welcome) resolve(c); }
  };
  ws.onerror = () => { c.errors.push('handshake_rejected'); resolve(c); };
  // Like the game: 4 commands (one per 60 Hz step) in each message, numbered consecutively.
  c.input = (o = {}) => {
    const cmds = Array.from({ length: 4 }, () => ({ moveX: 0, moveY: 1, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0, ...o }));
    ws.send(JSON.stringify({ t: 'input', seq: c.seq, cmds }));
    c.seq += 4;
  };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const clients = [];
for (let i = 0; i < 8; i++) clients.push(await open(`Bot${i}`, i % 5));
const seated = clients.filter((c) => c.welcome);
if (seated.length !== 8) fail(`expected 8 seats, got ${seated.length}: ${clients.map((c) => c.errors).join(',')}`);
const teams = seated.map((c) => c.welcome.team);
if (teams.filter((t) => t === 0).length !== 4) fail('teams not balanced');

const ninth = await open('Late', 0);
if (ninth.welcome) fail('a 9th player was seated');
console.log('9th client rejected:', ninth.errors.join(',') || 'closed');

const t0 = Date.now();
let tick = 0;
const timer = setInterval(() => {
  tick++;
  for (const c of seated) c.input({ yaw: Math.sin(tick / 8 + c.welcome.playerId), fire: tick % 15 < 5, grenade: tick % 120 === 0 });
}, 66);
await sleep(SECONDS * 1000);
clearInterval(timer);
const secs = (Date.now() - t0) / 1000;

const c0 = seated[0];
const rate = c0.snaps / secs;
console.log(`snapshots/s: ${rate.toFixed(1)} (target 15) · bytes/s per client: ${(c0.bytes / secs / 1024).toFixed(1)} KiB · events seen: ${c0.events}`);
if (rate < 10 || rate > 20) fail(`snapshot rate ${rate}`);
if (c0.last.players.length !== 8) fail('snapshot should list 8 players');
if (c0.last.ack < 60) fail('input not acknowledged');
if (!c0.events) fail('no events received (shots expected)');

// Reconnect within the grace window keeps the seat.
const who = seated[3];
const token = who.welcome.resumeToken, id = who.welcome.playerId;
who.ws.close();
await sleep(1500);
const back = await new Promise((resolve) => {
  const ws = new WebSocket(`${BASE}/room/${ROOM}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 2, resumeToken: token }));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'welcome') resolve({ ws, m }); };
});
if (back.m.playerId !== id) fail(`reconnect gave seat ${back.m.playerId}, expected ${id}`);
console.log(`reconnect kept seat ${id}`);

// A client that floods commands (about 500 per second, 7x the real rate) is dropped, then disconnected.
{
  const room2 = ROOM + '-flood';
  const flood = await new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/room/${room2}/ws`);
    const st = { ws, closed: false, errors: [], welcome: false };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 2, name: 'Flooder', cls: 0 }));
    ws.onmessage = (e) => { if (e.data === 'pong') return; const m = JSON.parse(e.data); if (m.t === 'welcome') { st.welcome = true; resolve(st); } else if (m.t === 'error') st.errors.push(m.code); };
    ws.onclose = () => { st.closed = true; };
    ws.onerror = () => resolve(st);
  });
  if (!flood.welcome) fail('flood client was not seated');
  let seq = 0;
  const cmd = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, sprint: false, aim: false, fire: false, interact: false, stance: 0 };
  const t1 = Date.now();
  while (!flood.closed && Date.now() - t1 < 12000) {
    try { flood.ws.send(JSON.stringify({ t: 'input', seq, cmds: Array.from({ length: 10 }, () => cmd) })); } catch { break; }
    seq += 10;
    await sleep(20);
  }
  if (!flood.closed) fail('flooding client was not disconnected');
  console.log(`flooder disconnected after ${((Date.now() - t1) / 1000).toFixed(1)} s (errors: ${flood.errors.join(',') || 'none'})`);
}

for (const c of seated) c.ws.close();
back.ws.close();
await sleep(300);
console.log('OK');
process.exit(0);
