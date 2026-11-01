import { COST, MAX_BODY_BYTES, PolicyError, parseOrigins, validateCall } from './policy';

/**
 * POST /rpc — Daily Pass RPC proxy. The upstream URL lives ONLY in the Worker secret
 * RPC_UPSTREAM_URL (never in the client bundle). NOT DEPLOYED: owner approval pending.
 */
export interface RpcEnv {
  /** Secret: private mainnet RPC URL (wrangler secret put RPC_UPSTREAM_URL). */
  RPC_UPSTREAM_URL?: string;
  /** Comma list of exact allowed browser origins, e.g. https://localhost (Capacitor). */
  RPC_ALLOWED_ORIGINS?: string;
  /** "true" to accept requests without an Origin header (native host). */
  RPC_ALLOW_NO_ORIGIN?: string;
  /** Workers Rate Limiting bindings (per client IP). */
  RPC_LIMIT?: RateLimit;
  RPC_TX_LIMIT?: RateLimit;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const envelope = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function handleRpc(request: Request, env: RpcEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const origin = request.headers.get('origin');
  let origins: Set<string>;
  try { origins = parseOrigins(env.RPC_ALLOWED_ORIGINS); } catch { return new Response(null, { status: 500 }); }
  const cors: Record<string, string> = {};
  if (origin !== null) {
    if (!origins.has(origin)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403, headers: JSON_HEADERS });
    cors['access-control-allow-origin'] = origin;
    cors.vary = 'Origin';
  } else if (env.RPC_ALLOW_NO_ORIGIN !== 'true') {
    return Response.json({ error: 'Origin is not allowed.' }, { status: 403, headers: JSON_HEADERS });
  }
  const headers = { ...JSON_HEADERS, ...cors };
  if (request.method === 'OPTIONS') {
    const wanted = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (origin === null || request.headers.get('access-control-request-method') !== 'POST' || wanted.some((h) => h !== 'content-type')) {
      return new Response(null, { status: 403, headers });
    }
    return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '300' } });
  }
  if (request.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405, headers: { ...headers, allow: 'POST, OPTIONS' } });
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return Response.json({ error: 'Use application/json.' }, { status: 415, headers });
  const upstream = env.RPC_UPSTREAM_URL;
  if (!upstream || !upstream.startsWith('https://')) return Response.json(envelope(null, -32003, 'RPC unavailable.'), { status: 503, headers });

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json(envelope(null, -32010, 'Request body is too large.'), { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json(envelope(null, -32700, 'Invalid JSON.'), { status: 400, headers }); }
  if (Array.isArray(body)) return Response.json(envelope(null, -32600, 'Batches are not permitted.'), { status: 400, headers });
  let call: ReturnType<typeof validateCall>;
  try { call = validateCall(body); } catch (e) {
    const p = e instanceof PolicyError ? e : new PolicyError();
    return Response.json(envelope((body as { id?: unknown })?.id, p.code, p.message), { status: 400, headers });
  }
  // Budget: one limiter token per cost unit; transaction relay also has its own tighter limit.
  for (let i = 0; i < COST[call.method]; i++) {
    if (env.RPC_LIMIT && !(await env.RPC_LIMIT.limit({ key: ip })).success) {
      return Response.json(envelope(call.id, -32005, 'RPC request budget exceeded.'), { status: 429, headers: { ...headers, 'retry-after': '60' } });
    }
  }
  if ((call.method === 'sendTransaction' || call.method === 'simulateTransaction') && env.RPC_TX_LIMIT && !(await env.RPC_TX_LIMIT.limit({ key: ip })).success) {
    return Response.json(envelope(call.id, -32005, 'RPC request budget exceeded.'), { status: 429, headers: { ...headers, 'retry-after': '60' } });
  }
  let res: Response;
  try {
    res = await fetchImpl(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal: AbortSignal.timeout(10_000) });
  } catch {
    const unknown = call.method === 'sendTransaction';
    return Response.json({ ...envelope(call.id, -32603, unknown ? 'Outcome unknown: check the signature before retrying.' : 'RPC gateway error.') }, { status: 502, headers });
  }
  const out = await res.text();
  if (out.length > 4_000_000) return Response.json(envelope(call.id, -32001, 'RPC response exceeded the limit.'), { status: 502, headers });
  return new Response(out, { status: res.ok ? 200 : 502, headers });
}
