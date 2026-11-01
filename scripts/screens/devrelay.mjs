// DEV-only read relay for headless screenshots: the public mainnet RPC answers 403 to any request
// carrying a browser Origin (and to Cloudflare Worker egress), so the mock E2E page talks to this
// local relay instead (`?devrpc=http://localhost:8787/rpc`). It forwards single JSON-RPC calls
// WITHOUT the Origin header and refuses anything that could broadcast.
import http from 'node:http';
const UP = 'https://api.mainnet-beta.solana.com';
const DENY = new Set(['sendTransaction', 'requestAirdrop']);
http.createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': 'http://localhost:4173', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  let call; try { call = JSON.parse(body); } catch { res.writeHead(400, cors); return res.end(); }
  if (Array.isArray(call) || DENY.has(call.method)) { res.writeHead(403, cors); return res.end('{"error":"denied"}'); }
  const r = await fetch(UP, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  res.writeHead(r.status, { ...cors, 'content-type': 'application/json' }); res.end(await r.text());
}).listen(8787, '127.0.0.1');
