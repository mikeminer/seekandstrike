import { PROTOCOL_VERSION } from '@shared/protocol';
import { handleRpc } from './rpc/handler';
import { MatchRoom, type Env } from './room/matchRoom';

export { MatchRoom };
export type { Env };

/** Worker entry: /health, /rpc (Daily Pass RPC proxy) and /room/<id>/ws (authoritative MatchRoom). */
const ROOM_ID = /^[a-z0-9-]{4,32}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/rpc') return handleRpc(request, env);
    const m = /^\/room\/([^/]+)\/ws$/.exec(url.pathname);
    if (m) {
      const roomId = m[1] ?? '';
      if (!ROOM_ID.test(roomId)) return new Response('Bad room id', { status: 400 });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(roomId));
      return stub.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
