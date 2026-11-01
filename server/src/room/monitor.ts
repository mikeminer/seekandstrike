/**
 * Per-seat checks that run on the server. Movement and turning cannot be forged in the first place (the client sends
 * commands, the server runs the shared sim and bounds the view turn rate); these checks cover what remains:
 *
 *  - command rate: a token bucket (60 commands/s plus a burst allowance for a stalled connection catching up). Excess
 *    commands are dropped, and a sustained flood is a HARD violation (the seat is kicked);
 *  - speed: the horizontal speed the sim actually produced is compared with the physical maximum. It cannot happen
 *    unless there is a server bug, so it is counted and logged, never punished;
 *  - view time: lag compensation values from the future or older than the rewind limit are clamped and counted;
 *  - aim statistics: hit and headshot ratios over windows of 40 shots. Statistics alone are not proof, so these are
 *    SOFT flags (reported, never an automatic kick).
 */
import { MOVE } from '@shared/sim/movement';

export const MONITOR = {
  /** Commands per second a client may produce (one per 60 Hz step) plus 25% slack for clock differences. */
  refillPerSecond: 75,
  /** Largest backlog accepted at once (about 2 s), enough for a connection stall that releases a burst. */
  burst: 120,
  /** Leaky-bucket score of dropped commands: more than this is a flood. */
  floodScore: 300,
  floodDecayPerSecond: 30,
  /** Fastest horizontal speed that is physically possible (sprint with some slack), m/s. */
  maxSpeed: MOVE.sprintSpeed * 1.5,
  aimWindowShots: 40,
  aimHitRatio: 0.9,
  aimHeadRatio: 0.7,
  aimMinHitsForHeadRatio: 20,
} as const;

export interface MonitorStats {
  received: number;
  accepted: number;
  dropped: number;
  viewTimeClamped: number;
  speedViolations: number;
  maxSpeed: number;
  shots: number;
  hits: number;
  headHits: number;
  aimFlags: number;
}

export class SeatMonitor {
  readonly stats: MonitorStats = {
    received: 0, accepted: 0, dropped: 0, viewTimeClamped: 0, speedViolations: 0, maxSpeed: 0, shots: 0, hits: 0, headHits: 0, aimFlags: 0,
  };
  private tokens: number = MONITOR.burst;
  private lastMs: number;
  private flood = 0;
  private windowShots = 0;
  private windowHits = 0;
  private windowHeads = 0;
  /** Set once the seat has flooded; the room kicks it. */
  kicked = false;

  constructor(nowMs: number) { this.lastMs = nowMs; }

  /** Takes `n` incoming commands; returns how many are accepted (the rest are dropped). */
  admit(nowMs: number, n: number): number {
    const dt = Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    this.tokens = Math.min(MONITOR.burst, this.tokens + dt * MONITOR.refillPerSecond);
    this.flood = Math.max(0, this.flood - dt * MONITOR.floodDecayPerSecond);
    const take = Math.min(n, Math.floor(this.tokens));
    this.tokens -= take;
    const dropped = n - take;
    this.stats.received += n;
    this.stats.accepted += take;
    this.stats.dropped += dropped;
    this.flood += dropped;
    if (this.flood > MONITOR.floodScore) this.kicked = true;
    return take;
  }

  /** Horizontal speed produced by one sim step, in m/s. Returns true when it exceeds the physical limit. */
  checkSpeed(speed: number): boolean {
    if (speed > this.stats.maxSpeed) this.stats.maxSpeed = speed;
    if (speed <= MONITOR.maxSpeed) return false;
    this.stats.speedViolations++;
    return true;
  }

  viewTimeClamped(): void { this.stats.viewTimeClamped++; }

  shot(): void { this.stats.shots++; this.windowShots++; this.evaluateAim(); }

  hit(head: boolean): void {
    this.stats.hits++; this.windowHits++;
    if (head) { this.stats.headHits++; this.windowHeads++; }
  }

  private evaluateAim(): void {
    if (this.windowShots < MONITOR.aimWindowShots) return;
    const hitRatio = this.windowHits / this.windowShots;
    const headRatio = this.windowHits > 0 ? this.windowHeads / this.windowHits : 0;
    if (hitRatio >= MONITOR.aimHitRatio || (this.windowHits >= MONITOR.aimMinHitsForHeadRatio && headRatio >= MONITOR.aimHeadRatio)) this.stats.aimFlags++;
    this.windowShots = 0; this.windowHits = 0; this.windowHeads = 0;
  }
}
