import { PROTOCOL_VERSION } from '@shared/protocol';
import { handleRpc } from './rpc/handler';
import { MatchRoom, type Env } from './room/matchRoom';
import { Leaderboard } from './leaderboard/leaderboard';
import { ONLINE_MAP_IDS, mapIdForRoom } from './room/map';
import { parseOrigins } from './rpc/policy';

export { MatchRoom, Leaderboard };
export type { Env };

/** Worker entry: /health, /rpc (Daily Pass RPC proxy) and /room/<id>/ws (authoritative MatchRoom). */
const ROOM_ID = /^[a-z0-9-]{4,32}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      // `maps`: the online maps this server runs (the game only offers online play on these). Public, read-only.
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION, maps: ONLINE_MAP_IDS, leaderboard: true }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === '/rpc') return handleRpc(request, env);
    if (url.pathname === '/leaderboard') {
      // Read-only, from the game only (same origin list as the RPC proxy).
      let origins: Set<string>;
      try { origins = parseOrigins(env.RPC_ALLOWED_ORIGINS); } catch { return new Response(null, { status: 500 }); }
      const origin = request.headers.get('Origin');
      if (!origin || !origins.has(origin)) return Response.json({ error: 'Origin is not allowed.' }, { status: 403 });
      const cors = { 'access-control-allow-origin': origin, vary: 'Origin' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-max-age': '300' } });
      if (request.method !== 'GET') return new Response('Use GET', { status: 405, headers: cors });
      const wallet = url.searchParams.get('wallet');
      const q = wallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ? `?wallet=${wallet}` : '';
      const res = await env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global')).fetch(`https://leaderboard/top${q}`);
      return new Response(res.body, { status: res.status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    const m = /^\/room\/([^/]+)\/ws$/.exec(url.pathname);
    if (m) {
      const roomId = m[1] ?? '';
      if (!ROOM_ID.test(roomId)) return new Response('Bad room id', { status: 400 });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(roomId));
      // The room's map comes from its name (e.g. magazzini-sale-2); the object learns it from this header.
      const fwd = new Request(request);
      fwd.headers.set('x-ss-map', mapIdForRoom(roomId));
      return stub.fetch(fwd);
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
