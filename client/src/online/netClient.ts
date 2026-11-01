import { PROTOCOL_VERSION, type ErrorCode, type InputMessage, type ServerMessage, type Snapshot } from '@shared/protocol';
import type { MoveCmd } from '@shared/sim/playerMove';
import { PROOF_TTL_MS, parseChallengeMessage } from '@shared/passProof';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
/** Server refusals, a transport failure, or `wallet`: the player's wallet did not sign the access proof. */
export type NetError = ErrorCode | 'socket' | 'wallet';
export type NetState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetOptions {
  /** e.g. ws://localhost:8787 (no trailing slash, no path). */
  baseUrl: string;
  room: string;
  name: string;
  cls: number;
  /**
   * Daily Pass proof. `wallet` is the connected wallet's address; `sign` signs the exact text it is given and returns the
   * base64 signature (null when the player declined or the wallet cannot sign). Needed only when the server asks for a proof.
   */
  wallet?: string;
  sign?: (message: string) => Promise<string | null>;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
  /** Reconnect attempts keep going for at most this long (the server holds the seat for 20 s). */
  reconnectWindowMs?: number;
  pingEveryMs?: number;
}

export interface NetHandlers {
  onSnapshot?: (s: Snapshot, recvMs: number) => void;
  onRoundEnd?: (winner: 0 | 1, restartInMs: number) => void;
  onState?: (s: NetState) => void;
  onError?: (code: NetError) => void;
}

const ROOM_ID = /^[a-z0-9-]{4,32}$/;

/**
 * WebSocket client for the authoritative MatchRoom. Sends input states, receives snapshots, measures the
 * round trip with JSON pings and, after an unexpected drop, resumes the same seat with the token from `welcome`.
 */
export class NetClient {
  state: NetState = 'idle';
  welcome: Welcome | null = null;
  /** Smoothed round-trip time in ms (0 until the first pong). */
  rtt = 0;
  private ws: WebSocket | null = null;
  private pingId = 0;
  private pings = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lostAt = 0;
  private closedByUs = false;
  private pendingResolve: ((w: Welcome) => void) | null = null;
  private pendingReject: ((e: Error) => void) | null = null;
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;

  constructor(private readonly o: NetOptions, private readonly h: NetHandlers = {}) {
    if (!ROOM_ID.test(o.room)) throw new Error('bad room id');
    this.WS = o.WebSocketImpl ?? WebSocket;
    this.now = o.now ?? (() => performance.now());
  }

  private setState(s: NetState): void { if (this.state !== s) { this.state = s; this.h.onState?.(s); } }

  /** Opens the socket and resolves with the server's welcome (rejects on a refusal or error). */
  connect(): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.open(false);
    });
  }

  private open(resume: boolean): void {
    this.setState(resume ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try { ws = new this.WS(`${this.o.baseUrl}/room/${this.o.room}/ws`); } catch { this.fail('socket'); return; }
    this.ws = ws;
    ws.onopen = () => {
      const hello: Record<string, unknown> = { t: 'hello', v: PROTOCOL_VERSION, name: this.o.name, cls: this.o.cls };
      if (resume && this.welcome) hello.resumeToken = this.welcome.resumeToken;
      if (this.o.wallet) hello.wallet = this.o.wallet;
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (e: MessageEvent) => this.onMessage(typeof e.data === 'string' ? e.data : '');
    ws.onerror = () => { /* followed by onclose; handled there */ };
    ws.onclose = () => { if (ws === this.ws) this.onClosed(); };
  }

  private onMessage(raw: string): void {
    if (raw === 'pong') return; // runtime auto-response to a plain 'ping'
    let m: ServerMessage;
    try { m = JSON.parse(raw) as ServerMessage; } catch { return; }
    switch (m.t) {
      case 'welcome': {
        const first = this.welcome === null;
        this.welcome = m;
        this.setState('open');
        this.lostAt = 0;
        this.startPings();
        if (first || this.pendingResolve) { this.pendingResolve?.(m); this.pendingResolve = null; this.pendingReject = null; }
        break;
      }
      case 'challenge': void this.answerChallenge(m.message); break;
      case 'snap': this.h.onSnapshot?.(m, this.now()); break;
      case 'roundEnd': this.h.onRoundEnd?.(m.winner, m.restartInMs); break;
      case 'pong': {
        const sent = this.pings.get(m.id);
        if (sent !== undefined) {
          this.pings.delete(m.id);
          const sample = this.now() - sent;
          this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
        }
        break;
      }
      case 'error': this.fail(m.code); break;
    }
  }

  /**
   * Signs the server's challenge, but only if it is exactly our template for OUR wallet: a hostile or broken server must
   * not be able to get a signature over anything else (for example bytes that read as a transaction).
   */
  private async answerChallenge(text: string): Promise<void> {
    const ws = this.ws;
    const c = parseChallengeMessage(text);
    if (!ws || !c || !this.o.sign || !this.o.wallet || c.wallet !== this.o.wallet || c.exp - c.iat > PROOF_TTL_MS) return this.fail('wallet');
    let sig: string | null = null;
    try { sig = await this.o.sign(text); } catch { sig = null; }
    if (!sig) return this.fail('wallet');
    if (ws === this.ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'auth', sig }));
  }

  private fail(code: NetError): void {
    this.h.onError?.(code);
    if (this.pendingReject) { const rej = this.pendingReject; this.pendingResolve = null; this.pendingReject = null; rej(new Error(code)); }
    // Refusals are final: do not retry them.
    if (code !== 'socket') this.close();
  }

  private onClosed(): void {
    this.stopPings();
    if (this.closedByUs) { this.setState('closed'); return; }
    if (this.pendingReject) { this.fail('socket'); this.setState('closed'); return; } // never got a welcome
    if (!this.welcome) { this.setState('closed'); return; }
    // Unexpected drop while seated: resume within the server's grace window.
    if (this.lostAt === 0) this.lostAt = this.now();
    if (this.now() - this.lostAt > (this.o.reconnectWindowMs ?? 15_000)) { this.setState('closed'); this.h.onError?.('socket'); return; }
    this.setState('reconnecting');
    this.retryTimer = setTimeout(() => this.open(true), 1000);
  }

  private startPings(): void {
    this.stopPings();
    const every = this.o.pingEveryMs ?? 2000;
    const send = (): void => {
      if (this.ws?.readyState !== 1) return;
      const id = ++this.pingId;
      this.pings.set(id, this.now());
      if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value as number);
      this.ws.send(JSON.stringify({ t: 'ping', id }));
    };
    send();
    this.pingTimer = setInterval(send, every);
  }
  private stopPings(): void { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }

  /** Sends a batch of consecutive commands numbered from `seq`; returns false when the socket is not open. */
  sendInput(seq: number, cmds: MoveCmd[]): boolean {
    if (this.state !== 'open' || this.ws?.readyState !== 1) return false;
    const msg: InputMessage = { t: 'input', seq, cmds };
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closedByUs = true;
    this.stopPings();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try { this.ws?.close(1000, 'bye'); } catch { /* already closed */ }
    this.setState('closed');
  }
}
